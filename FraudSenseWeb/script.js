// Import Firebase configuration and initialize Firebase
import { BASE_URL, firebaseConfig } from './config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const merchants = ['Jarir Bookstore', 'Extra Stores', 'Danube', 'Panda', 'Albaik', 'STC'];
// Global variables
let riskDistributionChart = null;
let transactionsOverTimeChart = null;
let fraudByMerchantChart = null;

let allTransactions = [];
let currentSortKey = 'Date';
let currentSortDirection = 'desc';

let csvSortKey = 'Category';
let csvSortDirection = 'asc';
let csvResults = [];

const ITEMS_PER_PAGE = 10;
let dashboardVisibleCount = ITEMS_PER_PAGE;
let feedbackVisibleCount = ITEMS_PER_PAGE;
let csvVisibleCount = ITEMS_PER_PAGE;

let currentUser = null;
let targetFeedbackTxId = null; // To store the ID of the transaction to scroll to on feedback page

// --- Theme Management --- (Keep existing functions: applyTheme, loadTheme, toggleTheme, updateThemeButtons)
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggleButton = document.getElementById('themeToggle');
    if (toggleButton) {
        toggleButton.innerHTML = `<span class="material-icons">${theme === 'dark' ? 'brightness_7' : 'brightness_4'}</span>`;
    }
    localStorage.setItem('theme', theme);

    const textColor = theme === 'dark' ? '#e0e0e0' : '#424242';
    Chart.defaults.color = textColor;
    
    const tooltipTitleColor = theme === 'dark' ? '#e0e0e0' : '#212121';
    const tooltipBodyColor = theme === 'dark' ? '#e0e0e0' : '#212121';
    
    [riskDistributionChart, transactionsOverTimeChart, fraudByMerchantChart].forEach(chart => {
        if (chart) {
            chart.options.plugins.legend.labels.color = textColor;
            chart.options.plugins.tooltip.titleColor = tooltipTitleColor;
            chart.options.plugins.tooltip.bodyColor = tooltipBodyColor;
            if (chart.options.scales) {
                Object.values(chart.options.scales).forEach(scale => {
                    if (scale.ticks) scale.ticks.color = textColor;
                    if (scale.title) scale.title.color = textColor;
                    if (scale.grid) scale.grid.color = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
                });
            }
            chart.update();
        }
    });
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    updateThemeButtons(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    updateThemeButtons(newTheme);
}

function updateThemeButtons(theme) {
    const lightButton = document.getElementById('themeLightButton');
    const darkButton = document.getElementById('themeDarkButton');
    if (lightButton && darkButton) {
        lightButton.classList.toggle('active', theme === 'light');
        darkButton.classList.toggle('active', theme === 'dark');
    }
}

// --- Authentication --- //
function setupAuthUI() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const showLoginBtn = document.getElementById('show-login-btn');
    const showSignupBtn = document.getElementById('show-signup-btn');

    showLoginBtn.addEventListener('click', () => {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        showLoginBtn.classList.add('active');
        showSignupBtn.classList.remove('active');
    });

    showSignupBtn.addEventListener('click', () => {
        signupForm.classList.add('active');
        loginForm.classList.remove('active');
        showSignupBtn.classList.add('active');
        showLoginBtn.classList.remove('active');
    });

    document.getElementById('login-btn').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorElement = document.getElementById('login-error');
        errorElement.textContent = '';
        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            console.error("Login failed:", error);
            errorElement.textContent = error.message;
        }
    });

    document.getElementById('signup-btn').addEventListener('click', async () => {
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const displayName = document.getElementById('signup-displayname').value;
        const errorElement = document.getElementById('signup-error');
        errorElement.textContent = '';
        
        if (!displayName || displayName.trim() === '') {
            errorElement.textContent = "Please enter a display name";
            return;
        }
        
        // Add password length validation
        if (password.length < 8) {
            errorElement.textContent = "Password must be at least 8 characters long";
            return;
        }
        
        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            // Update profile with display name
            await userCredential.user.updateProfile({ displayName: displayName });
            console.log("User created with display name:", displayName);
            
            // Set default role as "user" in Firestore
            const userDocRef = db.collection('users').doc(userCredential.user.uid);
            await userDocRef.set({
                displayName: displayName,
                email: email,
                role: "user",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
        } catch (error) {
            console.error("Signup failed:", error);
            errorElement.textContent = error.message;
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            // Close profile dropdown if open
            const profileDropdown = document.querySelector('.profile-dropdown');
            if (profileDropdown) {
                profileDropdown.classList.remove('active');
            }
            await auth.signOut();
        } catch (error) {
            console.error("Logout failed:", error);
            alert("Logout failed: " + error.message);
        }
    });
    
    // Setup profile dropdown functionality
    setupProfileDropdown();
}

// --- Profile Dropdown --- //
function setupProfileDropdown() {
    const profileButton = document.getElementById('profileButton');
    const profileDropdown = document.querySelector('.profile-dropdown');
    
    if (profileButton) {
        profileButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from bubbling to document
            profileDropdown.classList.toggle('active');
        });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!profileButton?.contains(e.target) && profileDropdown?.classList.contains('active')) {
            profileDropdown.classList.remove('active');
        }
    });
}

// Function to generate user initials for avatar
function generateUserInitials(displayName) {
    if (!displayName) return "U";
    
    const names = displayName.trim().split(/\s+/);
    if (names.length === 1) {
        return names[0].charAt(0).toUpperCase();
    } else {
        return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
    }
}

// Global variable to track if user is admin
let isUserAdmin = false;

function handleAuthStateChanged(user) {
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    const userEmailElement = document.getElementById('user-email');
    const userDisplayNameElement = document.getElementById('user-displayname');
    const displayNameInput = document.getElementById('displayNameInput');
    const adminNavItem = document.getElementById('admin-nav-item');
    
    // Profile elements
    const userInitials = document.getElementById('userInitials');
    const userInitialsLarge = document.getElementById('userInitialsLarge');

    if (user) {
        currentUser = user;
        console.log("User logged in:", user.email);
        authOverlay.classList.remove('active');
        appContainer.classList.remove('hidden');
        
        // Update header with user info
        userEmailElement.textContent = user.email;
        userDisplayNameElement.textContent = user.displayName || 'User';
        
        // Update profile avatar initials
        const initials = generateUserInitials(user.displayName);
        if (userInitials) userInitials.textContent = initials;
        if (userInitialsLarge) userInitialsLarge.textContent = initials;
        
        // Set display name input in settings
        if (displayNameInput) {
            displayNameInput.value = user.displayName || '';
        }
        
        // Check if user is admin
        checkAdminRole(user.uid).then(isAdmin => {
            isUserAdmin = isAdmin;
            if (adminNavItem) {
                adminNavItem.style.display = isAdmin ? 'list-item' : 'none';
            }
        });
        
        navigateToPage('home');
    } else {
        currentUser = null;
        isUserAdmin = false;
        console.log("User logged out");
        authOverlay.classList.add('active');
        appContainer.classList.add('hidden');
        userEmailElement.textContent = '';
        userDisplayNameElement.textContent = '';
        if (userInitials) userInitials.textContent = 'U';
        if (userInitialsLarge) userInitialsLarge.textContent = 'U';
        if (adminNavItem) {
            adminNavItem.style.display = 'none';
        }
        clearDashboard();
        clearFeedbackPage();
        clearHomePageResults();
        clearAdminPage();
    }
}

// Function to check if user has admin role
async function checkAdminRole(uid) {
    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            return userData.role === 'admin';
        } 
        return false;
    } catch (error) {
        console.error("Error checking admin role:", error);
        return false;
    }
}

// --- API Helper --- //
async function makeApiRequest(endpoint, method = 'GET', body = null, isFormData = false) {
    if (!currentUser) {
        throw new Error("User not authenticated");
    }

    try {
        const token = await currentUser.getIdToken();
        const headers = {
            'Authorization': `Bearer ${token}`
        };

        const options = { method, headers };

        if (body) {
            if (isFormData) {
                options.body = body;
            } else {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
        }

        const response = await fetch(`${BASE_URL}${endpoint}`, options);

        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { error: `HTTP error! status: ${response.status}` };
            }
            console.error(`API Error (${endpoint}):`, response.status, errorData);
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return await response.json();
        } else {
            return { status: response.status, message: "Operation successful" }; 
        }

    } catch (error) {
        console.error(`Error during API request to ${endpoint}:`, error);
        if (error.code === 'auth/id-token-expired' || error.message.includes('Unauthorized')) {
            alert("Session expired or invalid. Please log in again.");
            auth.signOut();
        }
        throw error;
    }
}

// --- Navigation --- //
function setupNavigation() {
    const navLinks = document.querySelectorAll('nav ul li a');
    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const targetPageId = link.getAttribute('data-page');
            navigateToPage(targetPageId);
        });
    });
}

function navigateToPage(pageId, params = {}) {
    const navLinks = document.querySelectorAll('nav ul li a');
    const pages = document.querySelectorAll('.page');

    navLinks.forEach(navLink => {
        navLink.classList.toggle('active', navLink.getAttribute('data-page') === pageId);
    });

    pages.forEach(page => {
        page.classList.toggle('active', page.id === `${pageId}-page`);
    });

    dashboardVisibleCount = ITEMS_PER_PAGE;
    feedbackVisibleCount = ITEMS_PER_PAGE;
    csvVisibleCount = ITEMS_PER_PAGE;

    // Store target transaction ID if navigating to feedback page
    if (pageId === 'feedback' && params.transactionId) {
        targetFeedbackTxId = params.transactionId;
        console.log("Targeting feedback for TX:", targetFeedbackTxId);
    } else {
        targetFeedbackTxId = null; // Clear if navigating elsewhere or no ID provided
    }

    if (pageId === 'dashboard') {
        loadDashboardData();
    }
    if (pageId === 'feedback') {
        loadFeedbackData(); // This will now check targetFeedbackTxId
    }
    if (pageId === 'admin' && isUserAdmin) {
        loadAdminData();
    }
}

// --- Home Page Functions --- //
function setupHomePage() {
    const batchModeButton = document.getElementById('batchModeButton');
    const singleModeButton = document.getElementById('singleModeButton');
    const batchAnalysisSection = document.getElementById('batch-analysis');
    const singleAnalysisSection = document.getElementById('single-analysis');

    batchModeButton.addEventListener('click', () => {
        batchModeButton.classList.add('active');
        singleModeButton.classList.remove('active');
        batchAnalysisSection.classList.add('active');
        singleAnalysisSection.classList.remove('active');
    });

    singleModeButton.addEventListener('click', () => {
        singleModeButton.classList.add('active');
        batchModeButton.classList.remove('active');
        singleAnalysisSection.classList.add('active');
        batchAnalysisSection.classList.remove('active');
    });

    const csvInput = document.getElementById('csvInput');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const selectedFileName = document.getElementById('selectedFileName');
    csvInput.addEventListener('change', () => {
        if (csvInput.files.length > 0) {
            selectedFileName.textContent = csvInput.files[0].name;
            fileNameDisplay.classList.add('visible');
        } else {
            selectedFileName.textContent = 'No file selected';
            fileNameDisplay.classList.remove('visible');
        }
    });

    document.getElementById('uploadCsvButton').addEventListener('click', uploadCSV);
    document.getElementById('sendJsonButton').addEventListener('click', sendJSON);
    document.getElementById('generateRandomButton').addEventListener('click', generateRandomTransaction);
}

async function uploadCSV() {
    const fileInput = document.getElementById('csvInput');
    const merchantNameInput = document.getElementById('csvMerchantName');
    const loadingIndicator = document.getElementById('csvLoading');
    const resultContainer = document.getElementById('csvResult');
    const uploadButton = document.getElementById('uploadCsvButton');

    if (fileInput.files.length === 0) {
        showError(resultContainer, "Please select a CSV file.");
        return;
    }

    const file = fileInput.files[0];
    const merchantName = merchantNameInput.value.trim() || 'Unknown_Batch';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('merchant_name', merchantName);

    loadingIndicator.classList.remove('hidden');
    resultContainer.innerHTML = '';
    uploadButton.disabled = true;

    try {
        const results = await makeApiRequest('/csv', 'POST', formData, true);
        displayCSVResults(results);
    } catch (error) {
        showError(resultContainer, `Error uploading or processing CSV: ${error.message}`);
    } finally {
        loadingIndicator.classList.add('hidden');
        uploadButton.disabled = false;
    }
}

async function sendJSON() {
    const jsonInput = document.getElementById('jsonInput');
    const merchantNameInput = document.getElementById('jsonMerchantName');
    const loadingIndicator = document.getElementById('jsonLoading');
    const resultContainer = document.getElementById('jsonResult');
    const sendButton = document.getElementById('sendJsonButton');

    let dataToSend = {};
    const inputText = jsonInput.value.trim();
    const merchantName = merchantNameInput.value.trim() || 'Single_Transaction';

    try {
        try {
            dataToSend = JSON.parse(inputText);
        } catch (e) {
            const values = inputText.split(/[\s,;\t]+/);
            if (values.length === 29) {
                dataToSend = {};
                for (let i = 0; i < 28; i++) {
                    dataToSend[`V${i + 1}`] = parseFloat(values[i]);
                }
                dataToSend['Amount'] = parseFloat(values[28]);
                if (Object.values(dataToSend).some(isNaN)) {
                    throw new Error("Invalid numeric values in separated input.");
                }
            } else {
                throw new Error("Input must be a valid JSON object or 29 separated values (V1-V28, Amount).");
            }
        }
        
        if (!dataToSend.MerchantName) {
             dataToSend.MerchantName = merchantName;
        }
        if (!dataToSend.Date) {
            dataToSend.Date = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

    } catch (error) {
        showError(resultContainer, `Invalid input format: ${error.message}`);
        return;
    }

    loadingIndicator.classList.remove('hidden');
    resultContainer.innerHTML = '';
    sendButton.disabled = true;

    try {
        const result = await makeApiRequest('/predict_single', 'POST', dataToSend);
        displaySingleResult(result);
    } catch (error) {
        showError(resultContainer, `Error processing transaction: ${error.message}`);
    } finally {
        loadingIndicator.classList.add('hidden');
        sendButton.disabled = false;
    }
}

async function generateRandomTransaction() {
    try {
        const response = await fetch('Random_transactions.csv');
        const csvData = await response.text();
        
        // Parse the CSV data
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',');
        const dataLines = lines.slice(1);
        
        // Select a random transaction from the CSV
        const randomIndex = Math.floor(Math.random() * dataLines.length);
        const randomLine = dataLines[randomIndex].split(',');
        
        // Create the transaction object
        const randomData = {};
        for (let i = 0; i < headers.length; i++) {
            randomData[headers[i]] = parseFloat(randomLine[i]);
        }
                
        const randomMerchant = merchants[Math.floor(Math.random() * merchants.length)];
        
        document.getElementById('jsonMerchantName').value = randomMerchant;
        document.getElementById('jsonInput').value = JSON.stringify(randomData, null, 2);
        
        const resultContainer = document.getElementById("jsonResult");
        resultContainer.innerHTML = "";
        showInfo(resultContainer, 'Random transaction loaded from CSV. Click "Analyze Transaction" to process.');
    } catch (error) {
        console.error("Error loading random transaction:", error);
        const resultContainer = document.getElementById("jsonResult");
        showError(resultContainer, `Error loading random transaction: ${error.message}`);
    }
}

function displayCSVResults(results) {
    console.log("Displaying CSV results:", results);
    const container = document.getElementById("csvResult");
    container.innerHTML = "";

    if (!Array.isArray(results)) {
        showError(container, "Invalid data format received from server.");
        return;
    }
    if (results.length === 0) {
        showInfo(container, "No results returned from batch analysis.");
        return;
    }

    csvResults = [...results];

    let fraudCount = 0, highRiskCount = 0, mediumRiskCount = 0, lowRiskCount = 0;
    results.forEach(item => {
        if (item.Predicted_Class === 1) fraudCount++;
        if (item.Category === 'high') highRiskCount++;
        else if (item.Category === 'medium') mediumRiskCount++;
        else if (item.Category === 'low') lowRiskCount++;
    });

    const stats = document.createElement("div");
    stats.className = "stats";
    stats.innerHTML = `
      <p><span class="material-icons">analytics</span> Total Analyzed: ${results.length}</p>
      <p><span class="material-icons">error</span> High Risk: ${highRiskCount}</p>
      <p><span class="material-icons">help</span> Medium Risk: ${mediumRiskCount}</p>
      <p><span class="material-icons">check_circle</span> Low Risk: ${lowRiskCount}</p>
    `;
    container.appendChild(stats);

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";
    container.appendChild(tableWrapper);
    const table = document.createElement("table");
    table.className = "result-table";
    table.id = "csvResultTable";
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th data-sort-key="Transaction_ID">ID</th>
        <th data-sort-key="MerchantName">Merchant</th>
        <th data-sort-key="Date">Date</th>
        <th data-sort-key="Amount">Amount</th>
        <th data-sort-key="Category">Risk Level</th>
        <th data-sort-key="Fraud_Score">Fraud Score</th>
        <th data-sort-key="Predicted_Class">Predicted Status</th>
      </tr>
    `;
    thead.querySelectorAll('th[data-sort-key]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => sortCSVTable(th.getAttribute('data-sort-key')));
        if (th.getAttribute('data-sort-key') === csvSortKey) {
            th.classList.add(csvSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.id = "csvTableBody";
    table.appendChild(tbody);
    tableWrapper.appendChild(table);

    sortCSVTable(csvSortKey, true);

    const showMoreContainer = document.createElement('div');
    showMoreContainer.id = 'csvShowMoreContainer';
    showMoreContainer.className = 'show-more-container';
    container.appendChild(showMoreContainer);
    updateShowMoreButton('csv', csvResults.length, csvVisibleCount, () => {
        csvVisibleCount += ITEMS_PER_PAGE;
        renderCSVTableRows();
    });

    showSuccess(container, `Successfully analyzed ${results.length} transactions.`, true);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.innerWidth <= 768) addTableScrollIndicators();
}

function sortCSVTable(sortKey, initialSort = false) {
    if (!initialSort && sortKey === csvSortKey) {
        csvSortDirection = csvSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        csvSortKey = sortKey;
        csvSortDirection = 'asc';
    }

    csvResults.sort((a, b) => {
        let valA = a[csvSortKey];
        let valB = b[csvSortKey];
         if (csvSortKey === 'Date') {
            valA = new Date(valA || 0);
            valB = new Date(valB || 0);
        } else if (csvSortKey === 'Amount' || csvSortKey === 'Fraud_Score') {
            valA = parseFloat(valA || 0);
            valB = parseFloat(valB || 0);
        } else if (csvSortKey === 'Category') {
            const riskOrder = { 'low': 1, 'medium': 2, 'high': 3 };
            valA = riskOrder[(valA || '').toLowerCase()] || 0;
            valB = riskOrder[(valB || '').toLowerCase()] || 0;
        } else {
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }

        if (valA < valB) return csvSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return csvSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const table = document.getElementById('csvResultTable');
    if (table) {
        table.querySelectorAll('thead th[data-sort-key]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.getAttribute('data-sort-key') === csvSortKey) {
                th.classList.add(csvSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }
    
    if (!initialSort) {
        csvVisibleCount = ITEMS_PER_PAGE;
    }
    renderCSVTableRows();
    updateShowMoreButton('csv', csvResults.length, csvVisibleCount, () => {
        csvVisibleCount += ITEMS_PER_PAGE;
        renderCSVTableRows();
    });
}

function renderCSVTableRows() {
    const tbody = document.getElementById("csvTableBody");
    if (!tbody) return;
    tbody.innerHTML = '';

    const resultsToShow = csvResults.slice(0, csvVisibleCount);

    resultsToShow.forEach(item => {
        const row = document.createElement("tr");
        const category = item.Category || 'N/A';
        const status = item.Predicted_Class === 1 ? "Fraud" : "Legitimate";
        const statusClass = item.Predicted_Class === 1 ? "status-fraud" : "status-legitimate";
        const categoryClass = `status-${category.toLowerCase()}`;

        row.innerHTML = `
          <td>${item.TSID || 'N/A'}</td>
          <td>${item.MerchantName || 'N/A'}</td>
          <td>${item.Date ? new Date(item.Date).toLocaleString() : 'N/A'}</td>
          <td>$${item.Amount !== undefined ? parseFloat(item.Amount).toFixed(2) : 'N/A'}</td>
          <td><span class="transaction-status ${categoryClass}">${category.toUpperCase()}</span></td>
          <td>${item.Fraud_Score !== undefined ? item.Fraud_Score.toFixed(2) : 'N/A'}%</td>
          <td><span class="transaction-status ${statusClass}">${status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function displaySingleResult(result) {
    const container = document.getElementById("jsonResult");
    container.innerHTML = "";

    const category = result.Category || 'N/A';
    const status = result.Predicted_Class === 1 ? "Fraud" : "Legitimate";
    const statusClass = result.Predicted_Class === 1 ? "status-fraud" : "status-legitimate";
    const categoryClass = `status-${category.toLowerCase()}`;

    const resultDiv = document.createElement("div");
    resultDiv.className = "single-result-card";
    resultDiv.innerHTML = `
        <h3>Transaction Analysis Result</h3>
        <p><strong>Transaction ID:</strong> ${result.TSID || 'N/A'}</p>
        <p><strong>Merchant:</strong> ${result.MerchantName || 'N/A'}</p>
        <p><strong>Date:</strong> ${result.Date ? new Date(result.Date).toLocaleString() : 'N/A'}</p>
        <p><strong>Amount:</strong> $${result.Amount !== undefined ? parseFloat(result.Amount).toFixed(2) : 'N/A'}</p>
        <p><strong>Risk Level:</strong> <span class="transaction-status ${categoryClass}">${category.toUpperCase()}</span></p>
        <p><strong>Fraud Score:</strong> ${result.Fraud_Score !== undefined ? result.Fraud_Score.toFixed(2) : 'N/A'}%</p>
        <p><strong>Predicted Status:</strong> <span class="transaction-status ${statusClass}">${status}</span></p>
    `;
    container.appendChild(resultDiv);
    showSuccess(container, "Transaction analyzed successfully.", true);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearHomePageResults() {
    document.getElementById('csvResult').innerHTML = '';
    document.getElementById('jsonResult').innerHTML = '';
    document.getElementById('selectedFileName').textContent = 'No file selected';
    document.getElementById('csvInput').value = '';
    document.getElementById('jsonInput').value = '';
    document.getElementById('csvMerchantName').value = '';
    document.getElementById('jsonMerchantName').value = '';
    csvResults = [];
    csvVisibleCount = ITEMS_PER_PAGE;
}

// --- Dashboard Functions --- //
function setupDashboard() {
    document.getElementById('refreshDashboard').addEventListener('click', loadDashboardData);
    document.getElementById('categoryFilter').addEventListener('change', filterAndDisplayTransactions);
    document.getElementById('merchantFilter').addEventListener('input', filterAndDisplayTransactions);
    const tableHead = document.querySelector('#transactionTable thead');
    if (tableHead) {
        tableHead.addEventListener('click', (event) => {
            const header = event.target.closest('th[data-sort-key]');
            if (header) {
                const sortKey = header.getAttribute('data-sort-key');
                sortDashboardTable(sortKey);
            }
        });
    }
}

async function loadDashboardData() {
    const loadingIndicator = document.getElementById('dashboardLoading');
    const tableBody = document.getElementById('transactionTableBody');
    const noTransactionsMessage = document.getElementById('noTransactions');

    loadingIndicator.classList.remove('hidden');
    tableBody.innerHTML = '';
    noTransactionsMessage.classList.add('hidden');

    try {
        const data = await makeApiRequest('/transactions');
        allTransactions = data || [];
        console.log("Fetched transactions:", allTransactions);
        document.getElementById('categoryFilter').value = 'all';
        document.getElementById('merchantFilter').value = '';
        currentSortKey = 'Date';
        currentSortDirection = 'desc';
        dashboardVisibleCount = ITEMS_PER_PAGE;
        filterAndDisplayTransactions();
        updateDashboardCharts(allTransactions);
        updateSummaryStats(allTransactions);
    } catch (error) {
        console.error("Error loading dashboard data:", error);
        showError(tableBody, `Failed to load transactions: ${error.message}`, 'tr', 8);
        updateDashboardCharts([]);
        updateSummaryStats([]);
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function filterAndDisplayTransactions() {
    const categoryFilter = document.getElementById('categoryFilter').value;
    const merchantFilter = document.getElementById('merchantFilter').value.toLowerCase();

    let filteredTransactions = allTransactions.filter(tx => {
        const categoryMatch = categoryFilter === 'all' || (tx.Category && tx.Category.toLowerCase() === categoryFilter);
        const merchantMatch = !merchantFilter || (tx.MerchantName && tx.MerchantName.toLowerCase().includes(merchantFilter));
        return categoryMatch && merchantMatch;
    });

    sortDashboardTable(currentSortKey, true, filteredTransactions);
}

function sortDashboardTable(sortKey, skipToggle = false, transactionsToSort = null) {
    const dataToSort = transactionsToSort || allTransactions.filter(tx => {
         const categoryFilter = document.getElementById('categoryFilter').value;
         const merchantFilter = document.getElementById('merchantFilter').value.toLowerCase();
         const categoryMatch = categoryFilter === 'all' || (tx.Category && tx.Category.toLowerCase() === categoryFilter);
         const merchantMatch = !merchantFilter || (tx.MerchantName && tx.MerchantName.toLowerCase().includes(merchantFilter));
         return categoryMatch && merchantMatch;
    });

    if (!skipToggle && sortKey === currentSortKey) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortKey = sortKey;
        currentSortDirection = (sortKey === 'Amount' || sortKey === 'Fraud_Score') ? 'desc' : 'asc'; 
        if (sortKey === 'Date') currentSortDirection = 'desc';
    }

    dataToSort.sort((a, b) => {
        let valA = a[currentSortKey];
        let valB = b[currentSortKey];

        if (currentSortKey === 'Date') {
            valA = new Date(valA || 0);
            valB = new Date(valB || 0);
        } else if (currentSortKey === 'Amount' || currentSortKey === 'Fraud_Score') {
            valA = parseFloat(valA || 0);
            valB = parseFloat(valB || 0);
        } else if (currentSortKey === 'Predicted_Class') {
            valA = parseInt(valA || 0);
            valB = parseInt(valB || 0);
        } else if (currentSortKey === 'Category') {
            const riskOrder = { 'low': 1, 'medium': 2, 'high': 3 };
            valA = riskOrder[(valA || '').toLowerCase()] || 0;
            valB = riskOrder[(valB || '').toLowerCase()] || 0;
        } else {
            valA = (valA || '').toString().toLowerCase();
            valB = (valB || '').toString().toLowerCase();
        }

        if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll('#transactionTable thead th[data-sort-key]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-sort-key') === currentSortKey) {
            th.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });

    dashboardVisibleCount = ITEMS_PER_PAGE;
    renderTransactionTable(dataToSort);
}

function renderTransactionTable(transactions) {
    const tableBody = document.getElementById('transactionTableBody');
    const noTransactionsMessage = document.getElementById('noTransactions');
    tableBody.innerHTML = '';

    if (!transactions || transactions.length === 0) {
        noTransactionsMessage.classList.remove('hidden');
        updateShowMoreButton('dashboard', 0, 0, () => {});
        return;
    }

    // Make sure to hide the "no transactions" message when we have transactions
    noTransactionsMessage.classList.add('hidden');
    
    const transactionsToShow = transactions.slice(0, dashboardVisibleCount);

    transactionsToShow.forEach(tx => {
        const row = document.createElement('tr');
        const category = tx.Category || 'N/A';
        const status = tx.Predicted_Class === 1 ? "Fraud" : "Legitimate";
        const statusClass = tx.Predicted_Class === 1 ? "status-fraud" : "status-legitimate";
        const categoryClass = `status-${category.toLowerCase()}`;
        const feedbackGiven = tx.User_Feedback_Is_Fraud !== undefined && tx.User_Feedback_Is_Fraud !== null;

        row.innerHTML = `
            <td>${tx.TSID || 'N/A'}</td>
            <td>${tx.MerchantName || 'N/A'}</td>
            <td>${tx.Date ? new Date(tx.Date).toLocaleString() : 'N/A'}</td>
            <td>$${tx.Amount !== undefined ? parseFloat(tx.Amount).toFixed(2) : 'N/A'}</td>
            <td><span class="transaction-status ${categoryClass}">${category.toUpperCase()}</span></td>
            <td>${tx.Fraud_Score !== undefined ? tx.Fraud_Score.toFixed(2) : 'N/A'}%</td>
            <td><span class="transaction-status ${statusClass}">${status}</span></td>
            <td class="action-buttons">
                ${!feedbackGiven ? `
                <button class="verify-btn secondary-button" data-id="${tx.Transaction_ID}" title="Verify Transaction">
                    <span class="material-icons">fact_check</span> Verify
                </button>
                ` : `
                <span class="feedback-submitted ${tx.User_Feedback_Is_Fraud ? 'fraud' : 'legit'}" title="Feedback Submitted">
                    <span class="material-icons">${tx.User_Feedback_Is_Fraud ? 'flag' : 'check_circle'}</span>
                    ${tx.User_Feedback_Is_Fraud ? 'Fraud' : 'Legit'}
                </span>
                `}
            </td>
        `;

        // Add event listener for the new Verify button if feedback not given
        if (!feedbackGiven) {
            row.querySelector('.verify-btn').addEventListener('click', (e) => {
                const transactionId = e.currentTarget.getAttribute('data-id');
                navigateToPage('feedback', { transactionId: transactionId });
            });
        }

        tableBody.appendChild(row);
    });

    updateShowMoreButton('dashboard', transactions.length, dashboardVisibleCount, () => {
        dashboardVisibleCount += ITEMS_PER_PAGE;
        renderTransactionTable(transactions);
    });
}

function updateSummaryStats(transactions) {
    const total = transactions.length;
    const highRisk = transactions.filter(tx => tx.Category === 'high').length;
    const mediumRisk = transactions.filter(tx => tx.Category === 'medium').length;
    const lowRisk = transactions.filter(tx => tx.Category === 'low').length;

    document.getElementById('totalTransactions').textContent = total;
    document.getElementById('highRiskCount').textContent = highRisk;
    document.getElementById('mediumRiskCount').textContent = mediumRisk;
    document.getElementById('lowRiskCount').textContent = lowRisk;
}

function updateDashboardCharts(transactions) {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = theme === 'dark' ? '#e0e0e0' : '#424242';

    // 1. Risk Level Distribution
    const riskCounts = transactions.reduce((acc, tx) => {
        const category = tx.Category ? tx.Category.toLowerCase() : 'unknown';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
    }, {});

    const riskCtx = document.getElementById('riskDistributionChart').getContext('2d');
    if (riskDistributionChart) riskDistributionChart.destroy();
    riskDistributionChart = new Chart(riskCtx, {
        type: 'doughnut',
        data: {
            labels: ['High Risk', 'Medium Risk', 'Low Risk', 'Unknown'],
            datasets: [{
                label: 'Risk Distribution',
                data: [
                    riskCounts['high'] || 0,
                    riskCounts['medium'] || 0,
                    riskCounts['low'] || 0,
                    riskCounts['unknown'] || 0
                ],
                backgroundColor: [
                    'rgba(239, 83, 80, 0.7)', // High
                    'rgba(255, 167, 38, 0.7)', // Medium
                    'rgba(102, 187, 106, 0.7)', // Low
                    'rgba(158, 158, 158, 0.7)'  // Unknown
                ],
                borderColor: theme === 'dark' ? '#424242' : '#ffffff',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: textColor } },
                title: { display: false },
                tooltip: {}
            }
        }
    });

    // 2. Transactions Over Time
    const transactionsByDate = transactions.reduce((acc, tx) => {
        if (tx.Date) {
            try {
                const dateStr = new Date(tx.Date).toISOString().split('T')[0];
                if (!acc[dateStr]) {
                    acc[dateStr] = { total: 0, highRisk: 0 };
                }
                acc[dateStr].total += 1;
                if (tx.Category === 'high') {
                    acc[dateStr].highRisk += 1;
                }
            } catch (e) { console.warn("Invalid date format for chart:", tx.Date); }
        }
        return acc;
    }, {});

    const sortedDates = Object.keys(transactionsByDate).sort();
    const timeLabels = sortedDates;
    const totalData = sortedDates.map(date => transactionsByDate[date].total);
    const highRiskData = sortedDates.map(date => transactionsByDate[date].highRisk);

    const timeCtx = document.getElementById('transactionsOverTimeChart').getContext('2d');
    if (transactionsOverTimeChart) transactionsOverTimeChart.destroy();
    transactionsOverTimeChart = new Chart(timeCtx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [
                {
                    label: 'Total Transactions',
                    data: totalData,
                    borderColor: 'rgba(66, 165, 245, 0.8)',
                    backgroundColor: 'rgba(66, 165, 245, 0.2)',
                    tension: 0.1,
                    fill: true
                },
                {
                    label: 'High Risk Transactions',
                    data: highRiskData,
                    borderColor: 'rgba(239, 83, 80, 0.8)',
                    backgroundColor: 'rgba(239, 83, 80, 0.2)',
                    tension: 0.1,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { position: 'top', labels: { color: textColor } },
                title: { display: false },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });

    // 3. Top 5 Merchants by Fraud Rate
    const merchantStats = transactions.reduce((acc, tx) => {
        const merchant = tx.MerchantName || 'Unknown';
        if (!acc[merchant]) {
            acc[merchant] = { total: 0, fraud: 0 };
        }
        acc[merchant].total += 1;
        if (tx.Predicted_Class === 1) {
            acc[merchant].fraud += 1;
        }
        return acc;
    }, {});

    const merchantFraudRates = Object.entries(merchantStats)
        .map(([merchant, stats]) => ({ 
            merchant,
            fraudRate: stats.total > 0 ? (stats.fraud / stats.total) * 100 : 0,
            totalTransactions: stats.total
        }))
        .filter(item => item.totalTransactions > 0)
        .sort((a, b) => b.fraudRate - a.fraudRate)
        .slice(0, 5);

    const merchantLabels = merchantFraudRates.map(item => item.merchant);
    const merchantData = merchantFraudRates.map(item => item.fraudRate);

    const merchantCtx = document.getElementById('fraudByMerchantChart').getContext('2d');
    if (fraudByMerchantChart) fraudByMerchantChart.destroy();
    fraudByMerchantChart = new Chart(merchantCtx, {
        type: 'bar',
        data: {
            labels: merchantLabels,
            datasets: [{
                label: 'Fraud Rate (%)',
                data: merchantData,
                backgroundColor: 'rgba(239, 83, 80, 0.7)',
                borderColor: 'rgba(239, 83, 80, 1)',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { beginAtZero: true, max: 100, grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: 'Fraud Rate (%)', color: textColor } },
                y: { grid: { color: gridColor }, ticks: { color: textColor } }
            },
            plugins: {
                legend: { display: false },
                title: { display: false },
                tooltip: { 
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.x !== null) label += context.parsed.x.toFixed(2) + '%';
                            const merchantName = context.label;
                            const stats = merchantFraudRates.find(m => m.merchant === merchantName);
                            if (stats) label += ` (${stats.totalTransactions} txns)`;
                            return label;
                        }
                    }
                 }
            }
        }
    });
}

function clearDashboard() {
    document.getElementById('transactionTableBody').innerHTML = '';
    document.getElementById('noTransactions').classList.remove('hidden');
    updateSummaryStats([]);
    updateDashboardCharts([]);
    allTransactions = [];
    dashboardVisibleCount = ITEMS_PER_PAGE;
}

// --- Feedback Functions --- //
function setupFeedbackPage() {
    // No setup needed now as buttons are dynamically added
}

async function loadFeedbackData() {
    const loadingIndicator = document.getElementById('feedbackLoading');
    const pendingList = document.getElementById('pendingFeedbackList');
    const noFeedbackNeededMessage = document.getElementById('noFeedbackNeeded');

    loadingIndicator.classList.remove('hidden');
    pendingList.innerHTML = '';
    
    try {
        // Fetch all transactions if not already loaded
        if (allTransactions.length === 0) {
            const data = await makeApiRequest('/transactions');
            allTransactions = data || [];
        }

        const pendingFeedback = allTransactions.filter(tx => 
            tx.User_Feedback_Is_Fraud === undefined || tx.User_Feedback_Is_Fraud === null
        );
        
        pendingFeedback.sort((a, b) => new Date(b.Date || 0) - new Date(a.Date || 0));

        const completedFeedback = allTransactions.filter(tx => 
            tx.User_Feedback_Is_Fraud !== undefined && tx.User_Feedback_Is_Fraud !== null
        );

        if (pendingFeedback.length === 0) {
            noFeedbackNeededMessage.classList.remove('hidden');
            pendingList.innerHTML = ''; // Make sure list is empty
        } else {
            noFeedbackNeededMessage.classList.add('hidden');
            renderFeedbackList(pendingFeedback);
        }

        // Update feedback stats
        const totalFeedback = completedFeedback.length;
        const confirmedFraud = completedFeedback.filter(tx => tx.User_Feedback_Is_Fraud === true).length;
        const confirmedLegit = completedFeedback.filter(tx => tx.User_Feedback_Is_Fraud === false).length;

        document.getElementById('totalFeedbackCount').textContent = totalFeedback;
        document.getElementById('confirmedFraudCount').textContent = confirmedFraud;
        document.getElementById('confirmedLegitCount').textContent = confirmedLegit;

    } catch (error) {
        console.error("Error loading feedback data:", error);
        showError(pendingList, `Failed to load data for feedback: ${error.message}`);
        noFeedbackNeededMessage.classList.add('hidden'); // Hide the message when showing an error
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function renderFeedbackList(transactions) {
    const pendingList = document.getElementById('pendingFeedbackList');
    pendingList.innerHTML = '';

    const transactionsToShow = transactions.slice(0, feedbackVisibleCount);

    transactionsToShow.forEach(tx => {
        const item = document.createElement('div');
        // Add an ID to the feedback item div based on the transaction ID
        item.id = `feedback-item-${tx.Transaction_ID}`;
        item.className = 'feedback-item';
        const category = tx.Category || 'N/A';
        const status = tx.Predicted_Class === 1 ? "Fraud" : "Legitimate";
        const statusClass = tx.Predicted_Class === 1 ? "status-fraud" : "status-legitimate";
        const categoryClass = `status-${category.toLowerCase()}`;

        item.innerHTML = `
            <div class="feedback-details">
                <p><strong>ID:</strong> ${tx.TSID || 'N/A'}</p>
                <p><strong>Merchant:</strong> ${tx.MerchantName || 'N/A'}</p>
                <p><strong>Date:</strong> ${tx.Date ? new Date(tx.Date).toLocaleString() : 'N/A'}</p>
                <p><strong>Amount:</strong> $${tx.Amount !== undefined ? parseFloat(tx.Amount).toFixed(2) : 'N/A'}</p>
                <p><strong>Predicted Risk:</strong> <span class="transaction-status ${categoryClass}">${category.toUpperCase()}</span> (${tx.Fraud_Score !== undefined ? tx.Fraud_Score.toFixed(2) : 'N/A'}%)</p>
                <p><strong>Predicted Status:</strong> <span class="transaction-status ${statusClass}">${status}</span></p>
            </div>
            <div class="feedback-actions">
                <p>Was this transaction actually fraudulent?</p>
                <button class="feedback-btn fraud" data-id="${tx.Transaction_ID}" title="Yes, it was Fraud">
                    <span class="material-icons">flag</span> Yes (Fraud)
                </button>
                <button class="feedback-btn legit" data-id="${tx.Transaction_ID}" title="No, it was Legitimate">
                    <span class="material-icons">check_circle</span> No (Legitimate)
                </button>
            </div>
        `;
        item.querySelector('.feedback-btn.fraud').addEventListener('click', () => submitFeedback(tx.Transaction_ID, true));
        item.querySelector('.feedback-btn.legit').addEventListener('click', () => submitFeedback(tx.Transaction_ID, false));
        pendingList.appendChild(item);
    });

    updateShowMoreButton('feedback', transactions.length, feedbackVisibleCount, () => {
        feedbackVisibleCount += ITEMS_PER_PAGE;
        renderFeedbackList(transactions);
    });

    // Scroll to target transaction if ID is set
    if (targetFeedbackTxId) {
        // Use setTimeout to allow the DOM to update after rendering
        setTimeout(() => {
            const targetElement = document.getElementById(`feedback-item-${targetFeedbackTxId}`);
            if (targetElement) {
                console.log("Scrolling to feedback item:", targetFeedbackTxId);
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Add a temporary highlight
                targetElement.classList.add('highlight');
                setTimeout(() => {
                    targetElement.classList.remove('highlight');
                }, 2500);
            }
        }, 100);
    }
}

async function submitFeedback(transactionId, isFraud) {
    console.log(`Submitting feedback for ${transactionId}: Is Fraud = ${isFraud}`);
    const feedbackItem = document.querySelector(`#feedback-item-${transactionId}`);
    const dashboardRow = document.querySelector(`#transactionTableBody button[data-id="${transactionId}"]`)?.closest('tr');

    if (feedbackItem) {
        feedbackItem.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }
    if (dashboardRow) {
        dashboardRow.querySelectorAll('.action-buttons button').forEach(btn => btn.disabled = true);
    }

    try {
        await makeApiRequest('/feedback', 'POST', { Transaction_ID: transactionId, Is_Fraud: isFraud });
        showGlobalSuccess(`Feedback submitted for Transaction ID: ${transactionId}`);

        const transactionIndex = allTransactions.findIndex(tx => tx.Transaction_ID === transactionId);
        if (transactionIndex > -1) {
            allTransactions[transactionIndex].User_Feedback_Is_Fraud = isFraud;
            allTransactions[transactionIndex].Feedback_Timestamp = new Date().toISOString();
        }

        const activePageId = document.querySelector('.page.active')?.id;
        if (activePageId === 'feedback-page') {
            loadFeedbackData();
        } else if (activePageId === 'dashboard-page') {
            filterAndDisplayTransactions();
        }

    } catch (error) {
        console.error("Error submitting feedback:", error);
        showGlobalError(`Failed to submit feedback for ${transactionId}: ${error.message}`);
        if (feedbackItem) {
            feedbackItem.querySelectorAll('button').forEach(btn => btn.disabled = false);
        }
        if (dashboardRow) {
            dashboardRow.querySelectorAll('.action-buttons button').forEach(btn => btn.disabled = false);
        }
    }
}

function clearFeedbackPage() {
    document.getElementById('pendingFeedbackList').innerHTML = '';
    document.getElementById('noFeedbackNeeded').classList.remove('hidden');
    document.getElementById('totalFeedbackCount').textContent = '0';
    document.getElementById('confirmedFraudCount').textContent = '0';
    document.getElementById('confirmedLegitCount').textContent = '0';
    feedbackVisibleCount = ITEMS_PER_PAGE;
}

// --- Settings Functions --- //
function setupSettingsPage() {
    document.getElementById('resetAllDataButton').addEventListener('click', resetAllData);
    document.getElementById('themeLightButton').addEventListener('click', () => applyTheme('light'));
    document.getElementById('themeDarkButton').addEventListener('click', () => applyTheme('dark'));
    
    // Add display name update functionality
    document.getElementById('updateDisplayNameBtn').addEventListener('click', updateDisplayName);
}

async function resetAllData() {
    if (!confirm("Are you sure you want to delete ALL your transaction and feedback data? This action cannot be undone.")) {
        return;
    }

    console.log("Resetting all user data...");
    const resetButton = document.getElementById('resetAllDataButton');
    resetButton.disabled = true;
    resetButton.innerHTML = '<span class="material-icons">hourglass_top</span> Resetting...';

    try {
        await makeApiRequest('/reset_data', 'POST');
        showGlobalSuccess("All your transaction data has been successfully reset.");
        allTransactions = [];
        clearDashboard();
        clearFeedbackPage();
        clearHomePageResults();
        if (document.querySelector('.page.active')?.id === 'dashboard-page') loadDashboardData();
        if (document.querySelector('.page.active')?.id === 'feedback-page') loadFeedbackData();

    } catch (error) {
        console.error("Error resetting data:", error);
        showGlobalError(`Failed to reset data: ${error.message}`);
    } finally {
        resetButton.disabled = false;
        resetButton.innerHTML = '<span class="material-icons">delete</span> Reset My Transaction Data';
    }
}

// --- Utility Functions --- //
function showError(container, message, wrapperTag = 'div', colspan = 1) {
    container.innerHTML = '';
    const errorElement = document.createElement(wrapperTag);
    if (wrapperTag === 'tr') {
        errorElement.innerHTML = `<td colspan="${colspan}" class="error-message"><span class="material-icons">error</span> ${message}</td>`;
    } else {
        errorElement.className = 'error-message';
        errorElement.innerHTML = `<span class="material-icons">error</span> ${message}`;
    }
    container.appendChild(errorElement);
}

function showInfo(container, message, wrapperTag = 'div', colspan = 1) {
    container.innerHTML = '';
    const infoElement = document.createElement(wrapperTag);
     if (wrapperTag === 'tr') {
        infoElement.innerHTML = `<td colspan="${colspan}" class="info-message"><span class="material-icons">info</span> ${message}</td>`;
    } else {
        infoElement.className = 'info-message';
        infoElement.innerHTML = `<span class="material-icons">info</span> ${message}`;
    }
    container.appendChild(infoElement);
}

function showSuccess(container, message, prepend = false) {
    const successElement = document.createElement('div');
    successElement.className = 'success-message';
    successElement.innerHTML = `<span class="material-icons">task_alt</span> ${message}`;
    if (prepend) {
        container.prepend(successElement);
    } else {
        container.appendChild(successElement);
    }
}

function showGlobalSuccess(message) {
    alert(`Success: ${message}`);
}

function showGlobalError(message) {
    alert(`Error: ${message}`);
}

function updateShowMoreButton(type, totalItems, visibleItems, action) {
    let containerId, buttonId, parentSelector;
    if (type === 'dashboard') {
        parentSelector = '.transaction-table-container';
        buttonId = 'dashboardShowMoreBtn';
    } else if (type === 'feedback') {
        containerId = 'pendingFeedbackList';
        buttonId = 'feedbackShowMoreBtn';
    } else if (type === 'csv') {
        containerId = 'csvShowMoreContainer';
        buttonId = 'csvShowMoreBtn';
    } else {
        return;
    }

    const parentContainer = parentSelector ? document.querySelector(parentSelector) : document.getElementById(containerId);
    if (!parentContainer) return;

    // Remove existing button if present
    let button = document.getElementById(buttonId);
    if (button) button.remove();

    // Only create button if there are more items to show
    if (visibleItems < totalItems) {
        const remaining = totalItems - visibleItems;
        button = document.createElement('button');
        button.id = buttonId;
        button.className = 'show-more-button secondary-button';
        button.innerHTML = `<span class="material-icons">expand_more</span> Show More (${remaining} remaining)`;
        
        // Store the state data in the button's dataset
        button.dataset.type = type;
        button.dataset.totalItems = totalItems;
        button.dataset.visibleItems = visibleItems;
        
        button.addEventListener('click', function() {
            // Get current state from button's dataset
            const currentType = this.dataset.type;
            const currentTotal = parseInt(this.dataset.totalItems);
            const currentVisible = parseInt(this.dataset.visibleItems);
            
            // Call the action (which increases the count and re-renders content)
            action();
            
            // If we still need to update the button manually (for immediate feedback)
            const newVisible = currentVisible + ITEMS_PER_PAGE;
            const newRemaining = currentTotal - newVisible;
            
            if (newRemaining > 0) {
                // Update both the text and the stored state
                this.innerHTML = `<span class="material-icons">expand_more</span> Show More (${newRemaining} remaining)`;
                this.dataset.visibleItems = newVisible;
            } else {
                // No more items to show, remove the button
                this.remove();
            }
        });
        
        parentContainer.appendChild(button);
    }
}

function addTableScrollIndicators() {
    document.querySelectorAll('.table-wrapper').forEach(wrapper => {
        if (wrapper.querySelector('.scroll-indicator-left')) return;
        const table = wrapper.querySelector('table');
        if (!table) return;

        const indicatorLeft = document.createElement('div');
        indicatorLeft.className = 'scroll-indicator scroll-indicator-left hidden';
        indicatorLeft.innerHTML = '<span class="material-icons">chevron_left</span>';

        const indicatorRight = document.createElement('div');
        indicatorRight.className = 'scroll-indicator scroll-indicator-right';
        indicatorRight.innerHTML = '<span class="material-icons">chevron_right</span>';

        wrapper.style.position = 'relative';
        wrapper.appendChild(indicatorLeft);
        wrapper.appendChild(indicatorRight);

        const updateIndicators = () => {
            const maxScrollLeft = wrapper.scrollWidth - wrapper.clientWidth;
            indicatorLeft.classList.toggle('hidden', wrapper.scrollLeft <= 10);
            indicatorRight.classList.toggle('hidden', wrapper.scrollLeft >= maxScrollLeft - 10);
        };

        wrapper.addEventListener('scroll', updateIndicators);
        updateIndicators();
        setTimeout(updateIndicators, 500);
    });
}

// --- Back to Top Button --- //
function setupBackToTop() {
    const backToTopBtn = document.getElementById('backToTopBtn');
    window.onscroll = () => {
        if (document.body.scrollTop > 100 || document.documentElement.scrollTop > 100) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    };
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// --- Initialization --- //
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    loadTheme();
    setupAuthUI();
    setupNavigation();
    setupHomePage();
    setupDashboard();
    setupFeedbackPage();
    setupSettingsPage();
    setupBackToTop();

    auth.onAuthStateChanged(handleAuthStateChanged);

    const themeToggleButton = document.getElementById('themeToggle');
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', toggleTheme);
    }
    
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768) {
            addTableScrollIndicators();
        } else {
            document.querySelectorAll('.scroll-indicator').forEach(ind => ind.remove());
        }
    });

    // Add CSS for highlighting
    const style = document.createElement('style');
    style.textContent = `
        .feedback-item.highlight {
            animation: highlight-fade 2.5s ease-out;
            border-color: var(--accent-color);
            box-shadow: 0 0 10px var(--accent-color-light);
        }
        @keyframes highlight-fade {
            0% { background-color: var(--accent-color-light); }
            100% { background-color: transparent; }
        }
    `;
    document.head.appendChild(style);
});

async function updateDisplayName() {
    if (!currentUser) {
        showGlobalError("You must be logged in to update your display name.");
        return;
    }

    const displayNameInput = document.getElementById('displayNameInput');
    const newDisplayName = displayNameInput.value.trim();
    const updateButton = document.getElementById('updateDisplayNameBtn');
    
    if (!newDisplayName) {
        showGlobalError("Please enter a valid display name.");
        return;
    }
    
    updateButton.disabled = true;
    updateButton.innerHTML = '<span class="material-icons">hourglass_top</span>';
    
    try {
        await currentUser.updateProfile({ displayName: newDisplayName });
        
        // Update the display name in the header
        document.getElementById('user-displayname').textContent = newDisplayName;
        
        // Update profile avatar initials
        const initials = generateUserInitials(newDisplayName);
        const userInitials = document.getElementById('userInitials');
        const userInitialsLarge = document.getElementById('userInitialsLarge');
        if (userInitials) userInitials.textContent = initials;
        if (userInitialsLarge) userInitialsLarge.textContent = initials;
        
        showGlobalSuccess("Display name updated successfully!");
        console.log("Display name updated to:", newDisplayName);
    } catch (error) {
        console.error("Error updating display name:", error);
        showGlobalError(`Failed to update display name: ${error.message}`);
    } finally {
        updateButton.disabled = false;
        updateButton.innerHTML = '<span class="material-icons">refresh</span>';
    }
}

// --- Admin Panel Functions --- //
function setupAdminPanel() {
    if (!isUserAdmin) return;

    document.getElementById('downloadTransactionsButton').addEventListener('click', downloadAllTransactions);
    document.getElementById('downloadFeedbackButton').addEventListener('click', downloadAllFeedback);
    document.getElementById('sendTransactionButton').addEventListener('click', sendTransactionToUser);
    document.getElementById('generateRandomAdminButton').addEventListener('click', generateRandomAdminTransaction);
    document.getElementById('refreshUsersButton').addEventListener('click', loadUserList);
    document.getElementById('resetAllUsersDataButton').addEventListener('click', resetAllUsersData);

    // Added event listener for user dropdown
    const userDropdown = document.getElementById('userDropdown');
    if (userDropdown) {
        userDropdown.addEventListener('change', function() {
            const selectedUser = this.options[this.selectedIndex];
            const emailField = document.getElementById('targetUserEmail');
            if (selectedUser && selectedUser.value) {
                emailField.value = selectedUser.value;
            } else {
                emailField.value = '';
            }
        });
    }
}

async function loadAdminData() {
    if (!isUserAdmin) return;
    
    // Initialize admin panel
    setupAdminPanel();
    
    // Load user list
    await loadUserList();
    
    // Also populate the user dropdown
    await populateUserDropdown();
}

async function loadUserList() {
    if (!isUserAdmin) return;
    
    const userTableBody = document.getElementById('userTableBody');
    const noUsersMessage = document.getElementById('noUsers');
    
    userTableBody.innerHTML = '';
    
    try {
        // Make API request to get all users (will need to implement this endpoint)
        const users = await makeApiRequest('/admin/users');
        
        if (!users || users.length === 0) {
            noUsersMessage.classList.remove('hidden');
            return;
        }
        
        // Ensure "No users" message is hidden when we have users
        noUsersMessage.classList.add('hidden');
        
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.uid || 'N/A'}</td>
                <td>${user.email || 'N/A'}</td>
                <td>${user.displayName || 'N/A'}</td>
                <td>${user.role || 'user'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="secondary-button small-button toggle-role-btn" data-uid="${user.uid}" data-current-role="${user.role}">
                            ${user.role === 'admin' ? 'Make User' : 'Make Admin'}
                        </button>
                        <button class="danger-button small-button delete-user-data-btn" data-uid="${user.uid}">
                            <span class="material-icons">delete</span> Delete Data
                        </button>
                    </div>
                </td>
            `;
            
            const toggleButton = row.querySelector('.toggle-role-btn');
            toggleButton.addEventListener('click', () => toggleUserRole(user.uid, user.role));
            
            const deleteDataButton = row.querySelector('.delete-user-data-btn');
            deleteDataButton.addEventListener('click', () => resetUserData(user.uid, user.email || user.displayName || user.uid));
            
            userTableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading user list:", error);
        showError(userTableBody, `Failed to load users: ${error.message}`, 'tr', 5);
        noUsersMessage.classList.add('hidden'); // Hide the message when showing an error
    }
}

// New function to populate the user dropdown in the admin panel
async function populateUserDropdown() {
    if (!isUserAdmin) return;
    
    const userDropdown = document.getElementById('userDropdown');
    if (!userDropdown) return;
    
    // Clear existing options except the first one
    while (userDropdown.options.length > 1) {
        userDropdown.remove(1);
    }
    
    try {
        // Get all users
        const users = await makeApiRequest('/admin/users');
        
        if (users && users.length > 0) {
            // Sort users by display name for easier selection
            users.sort((a, b) => {
                const nameA = a.displayName || a.email || '';
                const nameB = b.displayName || b.email || '';
                return nameA.localeCompare(nameB);
            });
            
            // Add users to dropdown
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.email;
                option.textContent = user.displayName ? `${user.displayName} (${user.email})` : user.email;
                userDropdown.appendChild(option);
            });
        }
    } catch (error) {
        console.error("Error populating user dropdown:", error);
        // Add a disabled option indicating error
        const errorOption = document.createElement('option');
        errorOption.textContent = "Error loading users";
        errorOption.disabled = true;
        userDropdown.appendChild(errorOption);
    }
}

async function toggleUserRole(uid, currentRole) {
    if (!isUserAdmin) return;
    
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    
    try {
        await makeApiRequest('/admin/update_role', 'POST', {
            targetUid: uid,
            newRole: newRole
        });
        
        showGlobalSuccess(`User role updated successfully to ${newRole}`);
        loadUserList(); // Reload the user list
        populateUserDropdown(); // Also update the dropdown
    } catch (error) {
        console.error("Error updating user role:", error);
        showGlobalError(`Failed to update user role: ${error.message}`);
    }
}

async function downloadAllTransactions() {
    if (!isUserAdmin) return;
    
    try {
        const downloadButton = document.getElementById('downloadTransactionsButton');
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<span class="material-icons">hourglass_top</span> Downloading...';
        
        // Get authentication token
        const token = await currentUser.getIdToken();
        
        // Create download URL with token as query parameter
        const downloadUrl = `${BASE_URL}/admin/download_transactions?token=${token}`;
        
        // Open the URL in a new window/tab which will trigger the download
        window.open(downloadUrl, '_blank');
        
        console.log("Transaction download initiated successfully");
    } catch (error) {
        console.error("Error downloading transactions:", error);
        showGlobalError(`Failed to download transactions: ${error.message}`);
    } finally {
        const downloadButton = document.getElementById('downloadTransactionsButton');
        downloadButton.disabled = false;
        downloadButton.innerHTML = '<span class="material-icons">cloud_download</span> Download All Transactions';
    }
}

async function downloadAllFeedback() {
    if (!isUserAdmin) return;
    
    try {
        const downloadButton = document.getElementById('downloadFeedbackButton');
        downloadButton.disabled = true;
        downloadButton.innerHTML = '<span class="material-icons">hourglass_top</span> Downloading...';
        
        // Get authentication token
        const token = await currentUser.getIdToken();
        
        // Create download URL with token as query parameter
        const downloadUrl = `${BASE_URL}/admin/download_feedback?token=${token}`;
        
        // Open the URL in a new window/tab which will trigger the download
        window.open(downloadUrl, '_blank');
        
        console.log("Feedback download initiated successfully");
    } catch (error) {
        console.error("Error downloading feedback:", error);
        showGlobalError(`Failed to download feedback: ${error.message}`);
    } finally {
        const downloadButton = document.getElementById('downloadFeedbackButton');
        downloadButton.disabled = false;
        downloadButton.innerHTML = '<span class="material-icons">description</span> Download All Feedback';
    }
}

async function sendTransactionToUser() {
    if (!isUserAdmin) return;
    
    const userDropdown = document.getElementById('userDropdown');
    const emailInput = document.getElementById('targetUserEmail');
    const transactionDataInput = document.getElementById('transactionData');
    const resultContainer = document.getElementById('adminTransactionResult');
    
    const email = emailInput.value.trim();
    let transactionData;
    
    if (!email) {
        showError(resultContainer, "Please select a user or enter a target user email");
        return;
    }
    
    try {
        transactionData = JSON.parse(transactionDataInput.value.trim());
    } catch (error) {
        showError(resultContainer, "Invalid transaction data JSON. Please check the format.");
        return;
    }
    
    resultContainer.innerHTML = '';
    
    try {
        const result = await makeApiRequest('/admin/send_transaction', 'POST', {
            targetEmail: email,
            transactionData: transactionData
        });
        
        // Fetch the full transaction details to get TSID
        const transactions = await makeApiRequest('/transactions');
        const sentTransaction = transactions.find(tx => tx.Transaction_ID === result.transactionId);
        const displayId = sentTransaction?.TSID || result.transactionId;
        
        const successDiv = document.createElement("div");
        successDiv.className = "single-result-card";
        successDiv.innerHTML = `
            <h3>Transaction Sent Successfully</h3>
            <p><strong>Recipient:</strong> ${email}</p>
            <p><strong>Transaction ID:</strong> ${displayId || 'N/A'}</p>
            <p><strong>Merchant:</strong> ${transactionData.MerchantName || 'N/A'}</p>
            <p><strong>Amount:</strong> $${transactionData.Amount !== undefined ? parseFloat(transactionData.Amount).toFixed(2) : 'N/A'}</p>
        `;
        resultContainer.appendChild(successDiv);
        showSuccess(resultContainer, "Transaction sent successfully to user", true);
    } catch (error) {
        console.error("Error sending transaction:", error);
        showError(resultContainer, `Failed to send transaction: ${error.message}`);
    }
}

async function generateRandomAdminTransaction() {
    try {
        const response = await fetch('Random_transactions.csv');
        const csvData = await response.text();
        
        // Parse the CSV data
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',');
        const dataLines = lines.slice(1);
        
        // Select a random transaction from the CSV
        const randomIndex = Math.floor(Math.random() * dataLines.length);
        const randomLine = dataLines[randomIndex].split(',');
        
        // Create the transaction object
        const randomData = {};
        for (let i = 0; i < headers.length; i++) {
            randomData[headers[i]] = parseFloat(randomLine[i]);
        }
        
        // Add a random merchant name
        const randomMerchant = merchants[Math.floor(Math.random() * merchants.length)];
        randomData.MerchantName = randomMerchant;
        
        document.getElementById('transactionData').value = JSON.stringify(randomData, null, 2);
        
        const resultContainer = document.getElementById("adminTransactionResult");
        resultContainer.innerHTML = "";
        showInfo(resultContainer, 'Random transaction loaded from CSV. Click "Send Transaction" to process.');
    } catch (error) {
        console.error("Error loading random transaction:", error);
        const resultContainer = document.getElementById("adminTransactionResult");
        showError(resultContainer, `Error loading random transaction: ${error.message}`);
    }
}

function clearAdminPage() {
    if (document.getElementById('userTableBody')) {
        document.getElementById('userTableBody').innerHTML = '';
    }
    if (document.getElementById('adminTransactionResult')) {
        document.getElementById('adminTransactionResult').innerHTML = '';
    }
    if (document.getElementById('targetUserEmail')) {
        document.getElementById('targetUserEmail').value = '';
    }
    if (document.getElementById('transactionData')) {
        document.getElementById('transactionData').value = '';
    }
    if (document.getElementById('userDropdown')) {
        document.getElementById('userDropdown').selectedIndex = 0;
    }
}

async function resetUserData(uid, displayName) {
    if (!isUserAdmin) return;

    if (!confirm(`Are you sure you want to delete ALL transaction and feedback data for ${displayName}? This action cannot be undone.`)) {
        return;
    }

    console.log(`Resetting data for user ${uid} (${displayName})...`);
    try {
        await makeApiRequest('/admin/reset_user_data', 'POST', { targetUid: uid });
        showGlobalSuccess(`All transaction data for ${displayName} has been successfully reset.`);
        loadUserList(); // Reload the user list
    } catch (error) {
        console.error(`Error resetting data for user ${uid}:`, error);
        showGlobalError(`Failed to reset data for ${displayName}: ${error.message}`);
    }
}

async function resetAllUsersData() {
    if (!isUserAdmin) return;

    if (!confirm('Are you sure you want to delete ALL transaction data for ALL USERS? This action cannot be undone and will affect all users in the system.')) {
        return;
    }

    // Double-check with a more serious warning
    if (!confirm('WARNING: This will delete EVERY transaction and feedback record in the entire system for all users. This operation cannot be reversed. Continue?')) {
        return;
    }

    console.log("Resetting ALL users data...");
    const resetButton = document.getElementById('resetAllUsersDataButton');
    resetButton.disabled = true;
    resetButton.innerHTML = '<span class="material-icons">hourglass_top</span> Resetting...';

    try {
        const result = await makeApiRequest('/admin/reset_all_data', 'POST');
        
        showGlobalSuccess(`Successfully reset data: Deleted ${result.deleted_transactions} transactions from ${result.affected_users} users.`);
        
        // Refresh the users list
        loadUserList();
        
    } catch (error) {
        console.error("Error resetting all users data:", error);
        showGlobalError(`Failed to reset all users data: ${error.message}`);
    } finally {
        resetButton.disabled = false;
        resetButton.innerHTML = '<span class="material-icons">delete_forever</span> Reset All Users\' Transaction Data';
    }
}

