# FraudSenseEnhanced

FraudSenseEnhanced is a web application designed for real-time transaction fraud detection using a machine learning model. It provides a user-friendly interface for analyzing individual transactions or batches via CSV upload, along with user authentication, data management, and administrative features.

<!-- Optional: Add a screenshot here -->
<!-- ![Screenshot](path/to/screenshot.png) -->

## Features

**User Features:**

*   **Secure Authentication:** Sign up, login, and logout functionality using Firebase Authentication (Email/Password).
*   **Transaction Analysis:**
    *   **Single Transaction:** Input transaction details (V1-V28 features, Amount) manually or via a simplified format to get instant fraud prediction and risk score.
    *   **Batch Analysis:** Upload a CSV file containing multiple transactions for bulk processing and fraud assessment.
*   **Interactive Dashboard:** View a history of analyzed transactions, including details, predicted status (Fraud/Legitimate), fraud score, and risk category (Low, Medium, High). Charts visualize risk distribution, transactions over time, and fraud by merchant.
*   **Feedback Mechanism:** Submit feedback on the accuracy of predictions for individual transactions.
*   **Data Management:** Users can reset (delete) all their transaction and feedback data.
*   **Profile Management:** Update display name.
*   **Theme Customization:** Switch between light and dark themes.

**Admin Features:**

*   **User Management:** View all registered users and update their roles (assign 'admin' or 'user' privileges).
*   **Transaction Injection:** Send specific transaction data to any registered user for analysis.
*   **Data Export:**
    *   Download a CSV file containing all transactions from all users.
    *   Download a CSV file containing all feedback submitted by all users.

## Tech Stack

*   **Backend:** Python, Flask
*   **Machine Learning:** Scikit-learn (SVM Model), Pandas, NumPy
*   **Database:** Google Firestore (for storing user-specific transaction and feedback data)
*   **Authentication:** Firebase Authentication
*   **Frontend:** HTML, CSS, JavaScript (including Chart.js for visualizations)
*   **Deployment:** Dockerfile provided (configuration may be needed)

## Prerequisites

*   Python 3.8+
*   pip (Python package installer)
*   Firebase Account (for Authentication and Firestore)
*   Git (for cloning the repository)

## Setup

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/BasimNasserMu/FraudSenseEnhanced.git
    cd FraudSenseEnhanced
    ```

2.  **Firebase Setup:**
    *   Go to the [Firebase Console](https://console.firebase.google.com/).
    *   Create a new Firebase project.
    *   Enable **Authentication**:
        *   Navigate to Authentication -> Sign-in method.
        *   Enable the "Email/Password" provider.
    *   Enable **Firestore Database**:
        *   Navigate to Firestore Database -> Create database.
        *   Start in **production mode** (recommended).
        *   **Important Security Rules:** Apply appropriate security rules to protect user data. A basic rule structure to ensure users can only access their own data under `users/{uid}/transactions` would look like this (modify as needed):
          ```firestore-rules
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              // User profile data (e.g., role, email)
              match /users/{userId} {
                allow read: if request.auth != null;
                allow write: if request.auth.uid == userId; // Allow users to update their own profile
                // Admins might need broader access, managed via backend logic or specific admin rules
              }
              // User-specific transactions
              match /users/{userId}/transactions/{transactionId} {
                allow read, write, delete: if request.auth != null && request.auth.uid == userId;
              }
              // Add rules for other collections if necessary
            }
          }
          ```
    *   **Get Web Configuration:**
        *   Go to Project Settings (gear icon) -> Your apps.
        *   Click the Web icon (`</>`) to register a new web app or use an existing one.
        *   Copy the `firebaseConfig` object (containing `apiKey`, `authDomain`, `projectId`, etc.).
    *   **Get Service Account Key:**
        *   Go to Project Settings -> Service accounts.
        *   Click "Generate new private key" and download the JSON key file.
        *   **Important:** Rename this file to `serviceAccountKey.json` and place it in the **root directory** of the cloned project (`FraudSenseEnhanced/`). **Do not commit this file to version control.** Add `serviceAccountKey.json` to your `.gitignore` file.

3.  **Backend Setup:**
    *   Navigate to the project root directory (`FraudSenseEnhanced/`).
    *   Create and activate a Python virtual environment:
        ```bash
        python -m venv venv
        # On Windows
        # .\venv\Scripts\activate
        # On macOS/Linux
        source venv/bin/activate
        ```
    *   Install the required Python packages:
        ```bash
        pip install -r requirements.txt
        ```
    *   Ensure the `serviceAccountKey.json` file is in the project root directory.

4.  **Frontend Setup:**
    *   Open the `FraudSenseWeb/config.js` file.
    *   Replace the placeholder `firebaseConfig` object with the actual configuration copied from your Firebase project settings.
    *   Verify the `BASE_URL` constant. It should point to the address where the Flask backend will run (default is `http://127.0.0.1:5000`).
    *   **Security Warning:** The current `config.js` might contain hardcoded Firebase web keys. While Firebase web keys are generally considered public, it's better practice to manage these through environment variables or a build process, especially for production deployments.

## Running the Application

1.  **Start the Backend Server:**
    *   Make sure your virtual environment is activated.
    *   Run the Flask application from the project root directory (`FraudSenseEnhanced/`):
        ```bash
        python app/main.py
        ```
    *   The backend server should start, typically on `http://127.0.0.1:5000`.

2.  **Access the Frontend:**
    *   Open your web browser and navigate to the address where the backend is running (e.g., `http://127.0.0.1:5000`).
    *   The Flask app serves the frontend files.

## Usage

1.  **Sign Up / Login:** Use the interface to create a new account or log in with existing credentials.
2.  **Analyze Transactions:**
    *   **Single:** Navigate to the Home page, select "Single Transaction Analysis", enter the V1-V28 features and Amount (or use the random generator), and click "Analyze Transaction".
    *   **Batch:** Navigate to the Home page, select "Batch Transaction Analysis", choose a CSV file, optionally enter a merchant name, and click "Analyze CSV".
3.  **Dashboard:** Navigate to the Dashboard page to view charts summarizing transaction risk levels, trends over time, and fraud rates by merchant, along with a table of your recent transactions.
4.  **Feedback:** Navigate to the Feedback page. Here you can view transactions and mark them as actually fraudulent or legitimate.
5.  **Settings:** Update your display name or reset all your transaction data.
6.  **Admin Panel (Admins Only):** If your account has the 'admin' role, an "Admin" option will appear in the navigation. This panel allows managing users, sending transactions, and downloading aggregated data.

## Firestore Data Structure

User-specific data is stored in Firestore under a main `users` collection. Each user has a document identified by their Firebase UID. Within each user document, transactions are stored in a subcollection named `transactions`.

*   `users/{userId}`: Document containing user profile information (e.g., `email`, `displayName`, `role`, `createdAt`).
*   `users/{userId}/transactions/{transactionId}`: Document containing details of a single analyzed transaction, including input features, prediction results, feedback (if provided), and timestamps.

## Security Notes

*   **Service Account Key:** The `serviceAccountKey.json` file grants administrative access to your Firebase project. Keep it secure and **never** commit it to public repositories. Ensure it is listed in your `.gitignore` file. Consider using environment variables or secrets management solutions for production.
*   **Firebase Web Keys:** The Firebase web configuration keys (`apiKey`, etc.) in `FraudSenseWeb/config.js` are used by the frontend. While they don't grant administrative access, be mindful of their exposure. Consider using environment variables for production builds.
*   **Firestore Rules:** Ensure your Firestore security rules are properly configured to prevent unauthorized data access. The rules provided in the setup are a basic example and might need refinement based on your specific requirements.
*   **Dependencies:** Regularly update dependencies listed in `requirements.txt` to patch security vulnerabilities.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an Issue.