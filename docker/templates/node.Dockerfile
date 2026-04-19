FROM node:20-alpine
RUN apk add --no-cache git curl bash python3 make g++
WORKDIR /workspace
RUN npm install -g nodemon ts-node typescript vite
# Keep the container running with a shell
CMD ["/bin/bash"]
