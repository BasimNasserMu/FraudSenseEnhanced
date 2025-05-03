# FraudSenseEnhanced

FraudSenseEnhanced is a comprehensive fraud detection system that combines machine learning-based transaction analysis with a multi-user web interface. The system uses a pre-trained SVM model for detecting fraudulent transactions and integrates Firebase Authentication and Firestore for multi-user functionality.

## Key Features

- **Advanced Fraud Detection**: Uses SVM model to analyze transaction patterns and identify potential fraud
- **Multi-User Support**: Each user can sign up, log in, and manage their own transaction analysis data independently
- **Interactive Dashboard**: Visualize and explore transaction data and predictions
- **Feedback System**: Users can provide feedback on predictions to improve system accuracy
- **Firebase Integration**:
  - **Authentication**: Secure user sign-up and login (Email/Password)
  - **Firestore Database**: User transactions, predictions, and feedback are stored under each user's unique ID
  
## Project Structure

```
FraudSenseEnhanced/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── models/
│   │   ├── scaler.pkl
│   │   └── SVMModel.pkl
│   └── utils/
│       └── preprocessing.py
├── FraudSenseWeb/
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── config.js
├── requirements.txt
├── Dockerfile
├── serviceAccountKey.json
└── README.md
```

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone https://github.com/BasimNasserMu/FraudSenseEnhanced.git
   cd FraudSenseEnhanced
   ```

2. **Prerequisites:**
   - Python 3.11+ and `pip`
   - Ensure `serviceAccountKey.json` is present in the root directory
   - Firebase project with Email/Password sign-in enabled in Authentication

3. **Create a virtual environment:**
   ```
   python -m venv venv
   
   # On Linux/macOS:
   source venv/bin/activate
   # On Windows:
   venv\Scripts\activate
   ```

4. **Install the required dependencies:**
   ```
   pip install -r requirements.txt
   ```

5. **Run the application:**
   ```
   cd app
   python main.py
   ```
   
   The server will start on `http://0.0.0.0:5000`.

6. **Access the Frontend:**
   - Open your web browser and navigate to `http://localhost:5000`
   - You'll see the login/signup page
   - Create an account or log in to use the application

## Usage

### API Endpoints

All endpoints require a valid Firebase Authentication token (Bearer token in Authorization header):

- **POST /predict**: Predict if a single transaction is fraudulent
- **GET /transactions**: Retrieve user's transaction history
- **POST /feedback**: Submit user feedback on a prediction
- **POST /reset_data**: Reset the current user's data
- **POST /csv**: Upload CSV data for analysis

### Web Interface

The web interface provides:
- Login/signup forms
- Dashboard with transaction data visualization
- Feedback system for transaction verification
- Settings page for user data management

## Docker

To build and run the application using Docker:

1. **Build the Docker image:**
   ```
   docker build -t fraudsense-enhanced .
   ```

2. **Run the Docker container:**
   ```
   docker run -p 5000:5000 fraudsense-enhanced
   ```

## Firebase Integration Details

- **Authentication:** Uses Firebase Authentication for user sign-up and login
- **Firestore Database:** Data structure follows `/users/{uid}/transactions/{tx_id}`
- **Backend:** Uses Firebase Admin SDK to interact with Firestore and verify authentication tokens
- **Frontend:** Includes Firebase SDKs and handles authentication UI logic

## Notes

- The backend runs on port **5000**
- For production use, configure appropriate Firestore security rules
- The current implementation relies on backend token verification for security

## License

This project is licensed under the MIT License.
