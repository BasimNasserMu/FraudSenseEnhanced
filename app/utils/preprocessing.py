import pandas as pd
from sklearn.preprocessing import StandardScaler

def preprocess_data(data):
    """
    Preprocess the input data for prediction.
    """
    # Convert input data to a DataFrame
    transaction = pd.DataFrame([data])

    # Scale the data
    scaler = StandardScaler()
    transaction_scaled = scaler.fit_transform(transaction)

    return transaction_scaled