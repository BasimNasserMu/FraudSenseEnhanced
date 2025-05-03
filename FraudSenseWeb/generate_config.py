import json
import os

def generate_config():
    config_data = {}

    print("Welcome to the Config.js Generator!")

    # Collect user input for configuration
    config_data['BASE_URL'] = input("Enter the API Base URL: ")

    # Ensure the BASE_URL starts with http or https
    if not config_data['BASE_URL'].startswith(('http://', 'https://')):
        config_data['BASE_URL'] = 'http://' + config_data['BASE_URL']
    
    # Get the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, 'config.js')

    # Check if config.js exists
    if os.path.exists(config_path):
        print(f"Existing config.js found at {config_path}. Replacing it...")
    
    # Write the configuration to config.js (will create or replace)
    with open(config_path, 'w') as config_file:
        config_file.write(f'// Configuration file for FraudSense Web\n')
        config_file.write(f'export const BASE_URL = "{config_data["BASE_URL"]}";\n')

    print("config.js has been generated successfully!")

if __name__ == "__main__":
    generate_config()