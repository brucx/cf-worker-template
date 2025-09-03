#!/bin/bash

# E2E Test Runner Script
# This script sets up the environment and runs the complete test suite

set -e  # Exit on error

echo "======================================"
echo "   E2E Test Suite Runner"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running in CI environment
if [ "$CI" = "true" ]; then
    echo -e "${YELLOW}Running in CI environment${NC}"
    export WORKER_URL=${WORKER_URL:-"http://localhost:8787"}
else
    echo -e "${GREEN}Running in local environment${NC}"
fi

# Set default environment variables
export JWT_SECRET=${JWT_SECRET:-"test-secret-key"}
export MOCK_SERVER_PORT=${MOCK_SERVER_PORT:-8080}
export WORKER_PORT=${WORKER_PORT:-8787}

echo ""
echo "Configuration:"
echo "  JWT_SECRET: [HIDDEN]"
echo "  MOCK_SERVER_PORT: $MOCK_SERVER_PORT"
echo "  WORKER_PORT: $WORKER_PORT"
echo ""

# Function to cleanup processes
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    
    # Kill mock server if running
    if [ ! -z "$MOCK_SERVER_PID" ]; then
        echo "Stopping mock server (PID: $MOCK_SERVER_PID)..."
        kill $MOCK_SERVER_PID 2>/dev/null || true
    fi
    
    # Kill worker if running
    if [ ! -z "$WORKER_PID" ]; then
        echo "Stopping worker (PID: $WORKER_PID)..."
        kill $WORKER_PID 2>/dev/null || true
    fi
    
    # Kill any remaining wrangler processes
    pkill -f "wrangler dev" 2>/dev/null || true
    
    exit $1
}

# Set up trap to cleanup on exit
trap 'cleanup $?' EXIT INT TERM

# Check dependencies
echo "Checking dependencies..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi

# Install test dependencies if needed
if [ ! -d "test/node_modules" ]; then
    echo "Installing test dependencies..."
    cd test && npm install && cd ..
fi

# Start mock backend server
echo -e "\n${GREEN}Starting mock backend server...${NC}"
node test/mock-server.js &
MOCK_SERVER_PID=$!

# Wait for mock server to start
echo "Waiting for mock server to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:$MOCK_SERVER_PORT/health > /dev/null; then
        echo -e "${GREEN}Mock server is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Mock server failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Start Cloudflare Worker
echo -e "\n${GREEN}Starting Cloudflare Worker...${NC}"
npx wrangler dev --port $WORKER_PORT --local &
WORKER_PID=$!

# Wait for worker to start
echo "Waiting for Worker to be ready..."
for i in {1..60}; do
    if curl -s http://localhost:$WORKER_PORT > /dev/null; then
        echo -e "${GREEN}Worker is ready!${NC}"
        break
    fi
    if [ $i -eq 60 ]; then
        echo -e "${RED}Worker failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Run tests
echo -e "\n${GREEN}Running E2E tests...${NC}"
echo "======================================"

cd test

# Run tests with appropriate reporter based on environment
if [ "$CI" = "true" ]; then
    npm run test:ci
    TEST_EXIT_CODE=$?
else
    npm test
    TEST_EXIT_CODE=$?
fi

cd ..

# Report results
echo "======================================"
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
else
    echo -e "${RED}✗ Some tests failed${NC}"
fi

exit $TEST_EXIT_CODE