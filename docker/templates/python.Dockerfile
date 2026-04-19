FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
RUN pip install --no-cache-dir flask fastapi uvicorn requests numpy pandas
CMD ["/bin/bash"]
