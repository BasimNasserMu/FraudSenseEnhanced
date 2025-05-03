#!/usr/bin/env python3
import os
import shutil
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import pandas as pd
from sklearn.preprocessing import StandardScaler
import joblib
import numpy as np
import datetime
import traceback
from functools import wraps

# Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials, firestore, auth

app = Flask(__name__)
CORS(app, supports_credentials=True, resources={r"/*": {"origins": "*"}}) # Allow all origins for now, adjust as needed

# --- Firebase Initialization ---
try:
    # Path to your service account key file
    SERVICE_ACCOUNT_KEY_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "serviceAccountKey.json")
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase Admin SDK initialized successfully.")
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}")
    db = None # Indicate Firebase is not available

# --- Model Loading ---
model_path = os.path.join(os.path.dirname(__file__), "models/SVMModel.pkl")
svmModel = joblib.load(model_path)
Scaler_path = os.path.join(os.path.dirname(__file__), "models/scaler.pkl")
Scaler = joblib.load(Scaler_path)

# --- Web Files Path ---
web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "FraudSenseWeb")

# --- Helper Functions ---
def categorize_fraud_score(score):
    if score <= 50:
        return 'low'
    elif 51 <= score <= 70:
        return 'medium'
    else:
        return 'high'

def generate_tsid():
    """Generate a transaction ID in the format TS##### where ##### is a sequential number"""
    import random
    import datetime
    
    # Use current timestamp to ensure uniqueness
    timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S%f')
    # Take last 5 digits and add random digits to ensure uniqueness in case of concurrent requests
    random_digits = str(random.randint(10000, 99999))
    unique_number = str(int(timestamp[-6:]) + int(random_digits))[-5:]
    return f"TS{unique_number}"

# --- Authentication Decorator ---
def check_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not db:
            return jsonify({"error": "Firebase connection not available"}), 503

        id_token = request.headers.get('Authorization')
        if not id_token or not id_token.startswith('Bearer '):
            return jsonify({"error": "Unauthorized: Missing or invalid Authorization header"}), 401

        id_token = id_token.split('Bearer ')[1]

        try:
            # Verify the ID token while checking if the token is revoked.
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            # Add uid to Flask's g object or pass it as an argument if preferred
            kwargs['uid'] = uid
            print(f"Authenticated user: {uid}")
        except auth.RevokedIdTokenError:
            return jsonify({"error": "Unauthorized: Token revoked"}), 401
        except auth.InvalidIdTokenError:
            return jsonify({"error": "Unauthorized: Invalid token"}), 401
        except Exception as e:
            print(f"Error verifying token: {e}")
            return jsonify({"error": "Unauthorized: Could not verify token"}), 401

        return f(*args, **kwargs)
    return decorated_function

# --- Static File Serving ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    if path == "" or path == "/":
        return send_from_directory(web_dir, 'index.html')
    try:
        return send_from_directory(web_dir, path)
    except Exception as e:
        print(f"File not found: {path}. Serving index.html. Error: {e}")
        return send_from_directory(web_dir, 'index.html')

# --- API Endpoints ---
@app.route('/csv', methods=['POST'])
@check_auth
def predict_csv(uid):
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file part in the request"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        merchant_name = request.form.get('merchant_name', 'Unknown_Batch')

        df = pd.read_csv(file)
        original_df = df.copy()

        required_features = [f'V{i}' for i in range(1, 29)] + ['Amount']
        if not all(col in df.columns for col in required_features):
            missing_cols = [col for col in required_features if col not in df.columns]
            return jsonify({"error": f"Missing required columns: {', '.join(missing_cols)}"}), 400

        if 'MerchantName' not in df.columns or df['MerchantName'].isnull().all():
            df['MerchantName'] = merchant_name
            original_df['MerchantName'] = merchant_name
        if 'Date' not in df.columns:
            now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            df['Date'] = now_str
            original_df['Date'] = now_str
        else:
            # Ensure Date is string for Firestore
            original_df['Date'] = original_df['Date'].astype(str)

        # Scale Amount
        df['Amount_Scaled'] = Scaler.transform(df[['Amount']])

        # Use 'Amount' as feature name instead of 'Amount_Scaled' to match model training
        features_for_prediction = [f'V{i}' for i in range(1, 29)] + ['Amount']
        df['Amount'] = df['Amount_Scaled']  # Replace the original Amount with scaled version

        predictions = svmModel.predict(df[features_for_prediction])
        decision_score = svmModel.decision_function(df[features_for_prediction])

        fraud_score = 1 / (1 + np.exp(-decision_score))
        fraud_score = np.round(fraud_score * 100, 2)

        original_df['Predicted_Class'] = predictions.astype(int) # Ensure int
        original_df['Fraud_Score'] = fraud_score
        original_df['Category'] = original_df['Fraud_Score'].apply(categorize_fraud_score)

        # Prepare data for Firestore batch write
        batch = db.batch()
        results_list = []
        user_transactions_ref = db.collection('users').document(uid).collection('transactions')

        for index, row in original_df.iterrows():
            tx_data = row.to_dict()
            # Convert numpy types to standard Python types for Firestore
            for key, value in tx_data.items():
                if isinstance(value, np.generic):
                    tx_data[key] = value.item()
            
            # Add server timestamp
            tx_data['Timestamp'] = firestore.SERVER_TIMESTAMP
            
            # Generate a new document reference with an auto-generated ID
            doc_ref = user_transactions_ref.document()
            tx_data['Transaction_ID'] = doc_ref.id # Use Firestore generated ID
            
            # Generate a custom TSID for user-facing display
            tx_data['TSID'] = generate_tsid()
            
            batch.set(doc_ref, tx_data)
            
            # Prepare result for JSON response
            results_list.append({
                'Transaction_ID': doc_ref.id,
                'TSID': tx_data['TSID'],
                'MerchantName': tx_data.get('MerchantName'),
                'Date': tx_data.get('Date'),
                'Amount': tx_data.get('Amount'),
                'Predicted_Class': tx_data.get('Predicted_Class'),
                'Fraud_Score': tx_data.get('Fraud_Score'),
                'Category': tx_data.get('Category')
            })

        batch.commit()
        print(f"Logged {len(results_list)} transactions to Firestore for user {uid}")

        return jsonify(results_list), 200

    except Exception as e:
        print("Error in /csv endpoint:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/predict_single', methods=['POST'])
@check_auth
def predict_single(uid):
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        features_v = [data.get(f'V{i}', data.get(f'v{i}', 0)) for i in range(1, 29)]
        amount = data.get('Amount', data.get('amount', 0))
        merchant_name = data.get('MerchantName', 'Single_Transaction')
        transaction_date = data.get('Date', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

        input_df = pd.DataFrame([features_v], columns=[f'V{i}' for i in range(1, 29)])
        input_df['Amount'] = amount

        amount_scaled = Scaler.transform(input_df[['Amount']])[0][0]

        features_for_prediction = features_v + [amount_scaled]

        prediction = svmModel.predict([features_for_prediction])[0]
        decision_score = svmModel.decision_function([features_for_prediction])[0]

        fraud_score = 1 / (1 + np.exp(-decision_score))
        fraud_score = round(fraud_score * 100, 2)
        category = categorize_fraud_score(fraud_score)

        # Prepare data for Firestore
        tx_data = {
            'MerchantName': merchant_name,
            'Date': transaction_date,
            'Amount': float(amount), # Ensure float
            'Predicted_Class': int(prediction), # Ensure int
            'Fraud_Score': float(fraud_score),
            'Category': category,
            'Timestamp': firestore.SERVER_TIMESTAMP
        }
        for i in range(1, 29):
            tx_data[f'V{i}'] = float(features_v[i-1]) # Ensure float

        # Save to Firestore
        user_transactions_ref = db.collection('users').document(uid).collection('transactions')
        doc_ref = user_transactions_ref.document()
        tx_data['Transaction_ID'] = doc_ref.id
        
        # Generate a custom TSID for user-facing display
        tx_data['TSID'] = generate_tsid()
        
        doc_ref.set(tx_data)
        print(f"Logged single transaction {doc_ref.id} to Firestore for user {uid}")

        # Create a response dict without the SERVER_TIMESTAMP sentinel value
        response_data = {k: v for k, v in tx_data.items() if k != 'Timestamp'}
        # Add a formatted timestamp for the response
        response_data['Timestamp'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        return jsonify(response_data), 200

    except Exception as e:
        print("Error in /predict_single endpoint:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/transactions', methods=['GET'])
@check_auth
def get_transactions(uid):
    try:
        user_transactions_ref = db.collection('users').document(uid).collection('transactions')
        # Order by timestamp descending, limit results if needed
        query = user_transactions_ref.order_by('Timestamp', direction=firestore.Query.DESCENDING).limit(500) 
        docs = query.stream()

        transactions = []
        for doc in docs:
            data = doc.to_dict()
            # Ensure required fields for dashboard are present
            tx = {
                'Transaction_ID': data.get('Transaction_ID', doc.id),
                'TSID': data.get('TSID', 'TS00000'),  # Include TSID for display, with fallback for old records
                'MerchantName': data.get('MerchantName'),
                'Date': data.get('Date'),
                'Amount': data.get('Amount'),
                'Category': data.get('Category'),
                'Fraud_Score': data.get('Fraud_Score'),
                'Predicted_Class': data.get('Predicted_Class'),
                'User_Feedback_Is_Fraud': data.get('User_Feedback_Is_Fraud')
            }
            transactions.append(tx)

        return jsonify(transactions)
    except Exception as e:
        print("Error in /transactions endpoint:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/feedback', methods=['POST'])
@check_auth
def submit_feedback(uid):
    try:
        data = request.get_json()
        if not data or 'Transaction_ID' not in data or 'Is_Fraud' not in data:
            return jsonify({"error": "Missing Transaction_ID or Is_Fraud in request"}), 400

        transaction_id = data['Transaction_ID']
        is_fraud_feedback = data['Is_Fraud']

        # Reference to the specific transaction document
        tx_doc_ref = db.collection('users').document(uid).collection('transactions').document(transaction_id)

        # Check if the document exists before updating
        tx_doc = tx_doc_ref.get()
        if not tx_doc.exists:
             return jsonify({"error": "Transaction ID not found."}), 404

        # Update the document with feedback
        tx_doc_ref.update({
            'User_Feedback_Is_Fraud': is_fraud_feedback,
            'Feedback_Timestamp': firestore.SERVER_TIMESTAMP
        })
        print(f"Feedback submitted for transaction {transaction_id} by user {uid}")

        return jsonify({"message": "Feedback submitted successfully"}), 200

    except Exception as e:
        print("Error occurred in /feedback endpoint:")
        traceback.print_exc()
        return jsonify({"error": f"An internal server error occurred: {str(e)}"}), 500

@app.route('/reset_data', methods=['POST'])
@check_auth
def reset_data(uid):
    print(f"Received request for /reset_data from user {uid}")
    try:
        user_transactions_ref = db.collection('users').document(uid).collection('transactions')
        # Delete all documents in the subcollection (use batch delete for efficiency on large collections)
        docs = user_transactions_ref.stream()
        deleted_count = 0
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
            deleted_count += 1
            # Commit batch periodically if deleting many documents
            if deleted_count % 500 == 0:
                batch.commit()
                batch = db.batch() # Start a new batch
        
        if deleted_count % 500 != 0: # Commit any remaining deletes
             batch.commit()

        print(f"Deleted {deleted_count} transactions for user {uid}")
        return jsonify({"message": f"All transaction data for user {uid} has been reset."}), 200

    except Exception as e:
        print(f"Error occurred in /reset_data endpoint for user {uid}:")
        traceback.print_exc()
        return jsonify({"error": f"An internal server error occurred while resetting data: {str(e)}"}), 500

# --- Admin Endpoints ---
def check_admin_role(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not db:
            return jsonify({"error": "Firebase connection not available"}), 503

        # First check for token in Authorization header
        id_token = request.headers.get('Authorization')
        if id_token and id_token.startswith('Bearer '):
            id_token = id_token.split('Bearer ')[1]
        else:
            # If not in header, check for token in query parameters (for download endpoints)
            id_token = request.args.get('token')
            if not id_token:
                return jsonify({"error": "Unauthorized: Missing token in Authorization header or query parameters"}), 401

        try:
            # Verify the ID token
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
            
            # Check if user is admin
            user_ref = db.collection('users').document(uid).get()
            if not user_ref.exists:
                return jsonify({"error": "User not found"}), 403
                
            user_data = user_ref.to_dict()
            if not user_data.get('role') == 'admin':
                return jsonify({"error": "Unauthorized: Admin access required"}), 403
                
            # Add uid to kwargs for the wrapped function
            kwargs['uid'] = uid
            print(f"Admin access granted to user: {uid}")
            
        except Exception as e:
            print(f"Error verifying admin token: {e}")
            return jsonify({"error": "Unauthorized: Could not verify admin privileges"}), 401

        return f(*args, **kwargs)
    return decorated_function

@app.route('/admin/users', methods=['GET'])
@check_admin_role
def get_all_users(uid):
    try:
        users_ref = db.collection('users').stream()
        users_list = []
        
        for user_doc in users_ref:
            user_data = user_doc.to_dict()
            user_data['uid'] = user_doc.id
            users_list.append(user_data)
            
        return jsonify(users_list), 200
    except Exception as e:
        print("Error in /admin/users endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/update_role', methods=['POST'])
@check_admin_role
def update_user_role(uid):
    try:
        data = request.get_json()
        if not data or 'targetUid' not in data or 'newRole' not in data:
            return jsonify({"error": "Missing targetUid or newRole"}), 400
            
        target_uid = data['targetUid']
        new_role = data['newRole']
        
        if new_role not in ['admin', 'user']:
            return jsonify({"error": "Invalid role. Must be 'admin' or 'user'"}), 400
            
        # Update user role in Firestore
        user_ref = db.collection('users').document(target_uid)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({"error": "Target user not found"}), 404
            
        user_ref.update({"role": new_role})
        print(f"User {target_uid} role updated to {new_role} by admin {uid}")
        
        return jsonify({"message": f"User role updated successfully to {new_role}"}), 200
    except Exception as e:
        print("Error in /admin/update_role endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/send_transaction', methods=['POST'])
@check_admin_role
def send_transaction_to_user(uid):
    try:
        data = request.get_json()
        if not data or 'targetEmail' not in data or 'transactionData' not in data:
            return jsonify({"error": "Missing targetEmail or transactionData"}), 400
            
        target_email = data['targetEmail']
        transaction_data = data['transactionData']
        
        # Find user by email
        users_ref = db.collection('users').where('email', '==', target_email).limit(1).stream()
        target_user = None
        
        for user_doc in users_ref:
            target_user = user_doc
            break
            
        if not target_user:
            return jsonify({"error": f"User with email {target_email} not found"}), 404
            
        target_uid = target_user.id
        
        # Process transaction data through prediction model
        features_v = [transaction_data.get(f'V{i}', 0) for i in range(1, 29)]
        amount = transaction_data.get('Amount', 0)
        merchant_name = transaction_data.get('MerchantName', 'Admin_Transaction')
        transaction_date = transaction_data.get('Date', datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        
        input_df = pd.DataFrame([features_v], columns=[f'V{i}' for i in range(1, 29)])
        input_df['Amount'] = amount
        
        amount_scaled = Scaler.transform(input_df[['Amount']])[0][0]
        features_for_prediction = features_v + [amount_scaled]
        
        prediction = svmModel.predict([features_for_prediction])[0]
        decision_score = svmModel.decision_function([features_for_prediction])[0]
        
        fraud_score = 1 / (1 + np.exp(-decision_score))
        fraud_score = round(fraud_score * 100, 2)
        category = categorize_fraud_score(fraud_score)
        
        # Save transaction to target user's collection
        tx_data = {
            'MerchantName': merchant_name,
            'Date': transaction_date,
            'Amount': float(amount),
            'Predicted_Class': int(prediction),
            'Fraud_Score': float(fraud_score),
            'Category': category,
            'Timestamp': firestore.SERVER_TIMESTAMP
        }
        
        # Add all V1-V28 features
        for i in range(1, 29):
            tx_data[f'V{i}'] = float(features_v[i-1])
            
        # Add admin source information
        tx_data['Source'] = 'admin'
        tx_data['AdminUID'] = uid
        
        user_transactions_ref = db.collection('users').document(target_uid).collection('transactions')
        doc_ref = user_transactions_ref.document()
        tx_data['Transaction_ID'] = doc_ref.id
        
        # Generate a custom TSID for user-facing display
        tx_data['TSID'] = generate_tsid()
        
        doc_ref.set(tx_data)
        
        print(f"Admin {uid} sent transaction {doc_ref.id} to user {target_uid}")
        
        return jsonify({
            "message": "Transaction sent successfully",
            "transactionId": doc_ref.id
        }), 200
    except Exception as e:
        print("Error in /admin/send_transaction endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/download_transactions', methods=['GET'])
@check_admin_role
def download_transactions(uid):
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({"error": "Missing authentication token"}), 400
            
        # Verify token again for security
        try:
            decoded_token = auth.verify_id_token(token)
        except:
            return jsonify({"error": "Invalid token"}), 401
            
        # Get all user transactions
        all_transactions = []
        users_ref = db.collection('users').stream()
        
        for user_doc in users_ref:
            user_id = user_doc.id
            user_data = user_doc.to_dict()
            user_email = user_data.get('email', 'unknown')
            
            tx_refs = db.collection('users').document(user_id).collection('transactions').stream()
            for tx_doc in tx_refs:
                tx_data = tx_doc.to_dict()
                tx_data['UserID'] = user_id
                tx_data['UserEmail'] = user_email
                
                # Convert Firestore timestamp to string
                if 'Timestamp' in tx_data and isinstance(tx_data['Timestamp'], firestore.SERVER_TIMESTAMP.__class__):
                    tx_data['Timestamp'] = tx_data['Timestamp'].isoformat() if hasattr(tx_data['Timestamp'], 'isoformat') else str(tx_data['Timestamp'])
                    
                all_transactions.append(tx_data)
                
        if len(all_transactions) == 0:
            return jsonify({"error": "No transactions found"}), 404
            
        # Convert to DataFrame
        df = pd.DataFrame(all_transactions)
        
        # Delete any existing file first to avoid merged files
        temp_file = os.path.join(os.path.dirname(__file__), "all_transactions.csv")
        if os.path.exists(temp_file):
            os.remove(temp_file)
            print(f"Deleted existing file {temp_file}")
        
        # Reorder columns to put Amount and V1-V28 at the end
        # First identify all columns that need to be at the end
        v_columns = [f'V{i}' for i in range(1, 29)]
        end_columns = v_columns + ['Amount']
        
        # Get all other columns
        all_columns = list(df.columns)
        start_columns = [col for col in all_columns if col not in end_columns]
        
        # Reorder the DataFrame columns
        ordered_columns = start_columns + end_columns
        # Only include columns that actually exist in the DataFrame
        ordered_columns = [col for col in ordered_columns if col in df.columns]
        
        # Reorder the DataFrame
        df = df[ordered_columns]
        
        # Save to CSV file
        df.to_csv(temp_file, index=False)
        
        # Send file for download
        response = send_file(
            temp_file,
            mimetype='text/csv',
            as_attachment=True,
            download_name='all_transactions.csv'
        )
        
        # Remove file after sending
        @response.call_on_close
        def cleanup():
            try:
                os.remove(temp_file)
                print(f"Temporary file {temp_file} removed")
            except:
                pass
                
        return response
    except Exception as e:
        print("Error in /admin/download_transactions endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/download_feedback', methods=['GET'])
@check_admin_role
def download_feedback(uid):
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({"error": "Missing authentication token"}), 400
            
        # Verify token again for security
        try:
            decoded_token = auth.verify_id_token(token)
        except:
            return jsonify({"error": "Invalid token"}), 401
            
        # Get all user feedback
        all_feedback = []
        users_ref = db.collection('users').stream()
        
        for user_doc in users_ref:
            user_id = user_doc.id
            user_data = user_doc.to_dict()
            user_email = user_data.get('email', 'unknown')
            user_name = user_data.get('displayName', 'unknown')
            
            # Get transactions with feedback
            tx_refs = db.collection('users').document(user_id).collection('transactions').where(
                'User_Feedback_Is_Fraud', 'in', [True, False]).stream()
                
            for tx_doc in tx_refs:
                tx_data = tx_doc.to_dict()
                
                # Add user info
                tx_data['UserID'] = user_id
                tx_data['UserEmail'] = user_email
                tx_data['UserName'] = user_name
                
                # Extract V1-V28 features first into a separate dict to ensure proper order later
                v_features = {}
                for i in range(1, 29):
                    feature_key = f'V{i}'
                    if feature_key in tx_data:
                        v_features[feature_key] = tx_data.get(feature_key)
                
                # Format feedback info for CSV
                feedback_data = {
                    'Transaction_ID': tx_data.get('Transaction_ID'),
                    'UserID': user_id,
                    'UserEmail': user_email,
                    'UserName': user_name,
                    'MerchantName': tx_data.get('MerchantName'),
                    'Date': tx_data.get('Date'),
                    'Predicted_Class': tx_data.get('Predicted_Class'),
                    'Predicted_Fraud': 'Yes' if tx_data.get('Predicted_Class') == 1 else 'No',
                    'Fraud_Score': tx_data.get('Fraud_Score'),
                    'Risk_Category': tx_data.get('Category'),
                    'User_Feedback_Is_Fraud': tx_data.get('User_Feedback_Is_Fraud'),
                    'User_Feedback': 'Fraud' if tx_data.get('User_Feedback_Is_Fraud') else 'Legitimate',
                    'Feedback_Timestamp': tx_data.get('Feedback_Timestamp'),
                    'Prediction_Correct': tx_data.get('Predicted_Class') == 1 and tx_data.get('User_Feedback_Is_Fraud') or 
                                         tx_data.get('Predicted_Class') == 0 and not tx_data.get('User_Feedback_Is_Fraud')
                }
                
                # Move the Amount and V1-V28 features to the end
                if 'Amount' in tx_data:
                    feedback_data['Amount'] = tx_data.get('Amount')
                
                # Add V1-V28 features at the end
                for i in range(1, 29):
                    feature_key = f'V{i}'
                    if feature_key in v_features:
                        feedback_data[feature_key] = v_features[feature_key]
                
                all_feedback.append(feedback_data)
                
        if len(all_feedback) == 0:
            return jsonify({"error": "No feedback data found"}), 404
            
        # Convert to DataFrame and then to CSV
        df = pd.DataFrame(all_feedback)
        
        # Delete any existing file first to avoid merged files
        temp_file = os.path.join(os.path.dirname(__file__), "all_feedback.csv")
        if os.path.exists(temp_file):
            os.remove(temp_file)
            print(f"Deleted existing file {temp_file}")
        
        # Ensure Amount and V1-V28 are at the end if they exist in the DataFrame
        v_columns = [f'V{i}' for i in range(1, 29)]
        end_columns = ['Amount'] + v_columns 
        
        # Get all columns in the dataframe
        all_columns = list(df.columns)
        
        # Determine which columns should be at the beginning (everything except Amount and V1-V28)
        start_columns = [col for col in all_columns if col not in end_columns]
        
        # Create the final ordered column list
        # Only include end columns that actually exist in the DataFrame
        end_columns_existing = [col for col in end_columns if col in df.columns]
        ordered_columns = start_columns + end_columns_existing
        
        # Reorder the DataFrame
        df = df[ordered_columns]
        
        # Save to CSV file
        df.to_csv(temp_file, index=False)
        
        # Send file for download
        response = send_file(
            temp_file,
            mimetype='text/csv',
            as_attachment=True,
            download_name='all_feedback.csv'
        )
        
        # Remove file after sending
        @response.call_on_close
        def cleanup():
            try:
                os.remove(temp_file)
                print(f"Temporary file {temp_file} removed")
            except:
                pass
                
        return response
    except Exception as e:
        print("Error in /admin/download_feedback endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/reset_all_data', methods=['POST'])
@check_admin_role
def reset_all_data(uid):
    try:
        # Get all users
        users_ref = db.collection('users').stream()
        deleted_count = 0
        user_count = 0
        
        for user_doc in users_ref:
            user_id = user_doc.id
            user_count += 1
            
            # Skip deleting the admin's own transactions if they don't want to
            # Uncomment this if you want to keep admin's data
            # if user_id == uid:
            #     continue
            
            # Delete all transactions for this user
            user_tx_ref = db.collection('users').document(user_id).collection('transactions')
            docs = user_tx_ref.stream()
            
            batch = db.batch()
            batch_count = 0
            
            for doc in docs:
                batch.delete(doc.reference)
                deleted_count += 1
                batch_count += 1
                
                # Commit batch every 500 records
                if batch_count >= 500:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            
            # Commit any remaining changes
            if batch_count > 0:
                batch.commit()
        
        return jsonify({
            "message": f"Reset transaction data for {user_count} users. Deleted {deleted_count} transactions.",
            "deleted_transactions": deleted_count,
            "affected_users": user_count
        }), 200
        
    except Exception as e:
        print("Error in /admin/reset_all_data endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/reset_user_data', methods=['POST'])
@check_admin_role
def reset_user_data(uid):
    try:
        data = request.get_json()
        if not data or 'targetUid' not in data:
            return jsonify({"error": "Missing targetUid"}), 400
            
        target_uid = data['targetUid']
        
        # Check if user exists
        user_ref = db.collection('users').document(target_uid)
        if not user_ref.get().exists:
            return jsonify({"error": "User not found"}), 404
            
        # Delete all transactions for this user
        user_tx_ref = db.collection('users').document(target_uid).collection('transactions')
        docs = user_tx_ref.stream()
        
        batch = db.batch()
        deleted_count = 0
        
        for doc in docs:
            batch.delete(doc.reference)
            deleted_count += 1
            
            # Commit batch every 500 records
            if deleted_count % 500 == 0:
                batch.commit()
                batch = db.batch()
        
        # Commit any remaining changes
        if deleted_count % 500 != 0:
            batch.commit()
        
        print(f"Admin {uid} deleted {deleted_count} transactions for user {target_uid}")
        
        return jsonify({
            "message": f"Reset transaction data for user. Deleted {deleted_count} transactions.",
            "deleted_transactions": deleted_count
        }), 200
        
    except Exception as e:
        print("Error in /admin/reset_user_data endpoint:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("Starting Flask server...")
    app.run(host='0.0.0.0', port=5000, debug=True)

