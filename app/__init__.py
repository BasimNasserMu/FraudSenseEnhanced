from flask import Flask

app = Flask(__name__)

from app.routes import predict

# Additional configurations can be added here if needed.