#!/bin/bash
set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Orbit Docker Sandbox — Server Setup Script            ║"
echo "║       Target: Oracle Cloud ARM Ubuntu 22.04                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Install Docker ──────────────────────────────────────────────
if command -v docker &> /dev/null; then
    echo "✅ Docker already installed: $(docker --version)"
else
    echo "📦 Installing Docker..."
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release

    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker $USER
    echo "✅ Docker installed. You may need to log out and back in for group changes."
fi

# ─── 2. Create orbit-network ────────────────────────────────────────
echo ""
echo "🌐 Creating orbit-network..."
docker network create orbit-network 2>/dev/null || echo "   orbit-network already exists"

# ─── 3. Create workspace directory ──────────────────────────────────
echo ""
echo "📁 Creating workspace directory..."
sudo mkdir -p /tmp/orbit-workspaces
sudo chmod 777 /tmp/orbit-workspaces

# ─── 4. Build sandbox template images ───────────────────────────────
echo ""
echo "🔨 Building sandbox template images..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="${SCRIPT_DIR}/docker/templates"

echo "   Building orbit-node..."
docker build -t orbit-node:latest -f "${TEMPLATES_DIR}/node.Dockerfile" "${TEMPLATES_DIR}"

echo "   Building orbit-python..."
docker build -t orbit-python:latest -f "${TEMPLATES_DIR}/python.Dockerfile" "${TEMPLATES_DIR}"

echo "✅ Template images built successfully."

# ─── 5. Install Node.js + PM2 ───────────────────────────────────────
echo ""
if command -v node &> /dev/null; then
    echo "✅ Node.js already installed: $(node --version)"
else
    echo "📦 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 already installed"
else
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# ─── 6. Install project dependencies ────────────────────────────────
echo ""
echo "📦 Installing project dependencies..."
cd "${SCRIPT_DIR}"
npm install

# ─── 7. Build the project ───────────────────────────────────────────
echo ""
echo "🔨 Building Next.js + Terminal bridge..."
npm run build

# Compile terminal bridge separately
npx tsc src/server/terminal-bridge.ts --outDir dist/server \
    --esModuleInterop --moduleResolution node --target ES2020 --module commonjs \
    --skipLibCheck --resolveJsonModule 2>/dev/null || echo "   (Terminal bridge will use ts-node in dev)"

# ─── 8. Start with PM2 ──────────────────────────────────────────────
echo ""
echo "🚀 Starting Orbit with PM2..."
pm2 delete orbit-web 2>/dev/null || true
pm2 delete orbit-terminal 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Orbit is running!                                       ║"
echo "║                                                              ║"
echo "║  Web:      http://localhost:3000                             ║"
echo "║  Terminal: ws://localhost:3001                               ║"
echo "║                                                              ║"
echo "║  PM2 status: pm2 status                                     ║"
echo "║  PM2 logs:   pm2 logs                                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
