# Attack Range API - Quick Start Guide

Get the Attack Range API up and running in minutes!

## 🚀 Quick Start (Local)

### Option 1: Using the run script (Recommended)

```bash
cd api
./run.sh
```

The script will:
- Create a virtual environment
- Install all dependencies
- Start the Flask development server

### Option 2: Manual setup

```bash
# Navigate to API directory
cd api

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies (from project root)
pip install -r ../requirements.txt

# Run the API
python app.py
```

## 🐳 Quick Start (Docker)

```bash
# Build and run with Docker Compose
cd api
docker-compose up --build
```

## 📖 Access the API

Once running, access:

- **API**: http://localhost:4000
- **Swagger UI**: http://localhost:4000/openapi/swagger
- **ReDoc**: http://localhost:4000/openapi/redoc
- **OpenAPI JSON**: http://localhost:4000/openapi/openapi.json

## 🧪 Test the API

### Health Check

```bash
curl http://localhost:4000/health
```

### List Templates

```bash
curl http://localhost:4000/templates
```

### Get a Template

```bash
curl http://localhost:4000/templates/aws/splunk_minimal_aws
```

### Build an Attack Range (Two-Phase Process)

Attack Range build happens in two phases with VPN setup in between:

#### Phase 1: Start Build (VPN Setup)

```bash
# Start the build
curl -X POST http://localhost:4000/attack-range/build \
  -H "Content-Type: application/json" \
  -d '{"template": "aws/splunk_minimal_aws"}'
  
# Response includes attack_range_id
# Save this value!
```

#### Check Status and Get VPN Config

```bash
# Check status (replace {attack_range_id} with actual ID)
curl http://localhost:4000/attack-range/status/{attack_range_id}

# When status is "wait_for_vpn", download the WireGuard config:
curl -s http://localhost:4000/attack-range/status/{attack_range_id} | \
  jq -r '.wireguard_config' > attack_range.conf

# Activate the VPN using the config file
# (use WireGuard client to import attack_range.conf)
```

#### Phase 2: Continue Build (Lab Setup)

```bash
# After connecting to VPN, continue the build
curl -X POST http://localhost:4000/attack-range/build \
  -H "Content-Type: application/json" \
  -d '{"attack_range_id": "{attack_range_id}"}'

# Monitor status until "running"
curl http://localhost:4000/attack-range/status/{attack_range_id}
```

### Destroy an Attack Range

```bash
# List saved configs
curl http://localhost:4000/configs

# Destroy by config ID
curl -X POST http://localhost:4000/attack-range/destroy \
  -H "Content-Type: application/json" \
  -d '{"config_id": "your-config-id-here"}'
```

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore the interactive API docs at http://localhost:4000/openapi/swagger
- Check out the example Python client code in the README

## ⚙️ Configuration

### Cloud Provider Setup

Make sure you have configured your cloud provider credentials:

**AWS:**
```bash
# Configure AWS CLI
aws configure
# Or set environment variables
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_DEFAULT_REGION=us-east-1
```

**Azure:**
```bash
# Login to Azure
az login
# Or set environment variables
export AZURE_SUBSCRIPTION_ID=your_subscription_id
export AZURE_TENANT_ID=your_tenant_id
export AZURE_CLIENT_ID=your_client_id
export AZURE_CLIENT_SECRET=your_client_secret
```

**GCP:**
```bash
# Authenticate with GCP
gcloud auth application-default login
# Or set service account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
export GCP_PROJECT_ID=your_project_id
```

## 🔧 Troubleshooting

### Port already in use

```bash
# Find and kill the process using port 4000
lsof -ti:4000 | xargs kill -9
```

### Dependencies not installing

```bash
# Upgrade pip first
pip install --upgrade pip
# Then try again (from project root)
pip install -r ../requirements.txt
```

### Permission denied on run.sh

```bash
chmod +x run.sh
```

## 📞 Support

For issues, questions, or contributions, see the main project documentation.
