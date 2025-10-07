# frontend/Dockerfile

# --- Build Stage ---
FROM node:20 AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- Serve Stage ---
FROM nginx:stable-alpine

# Copy the built files from the build stage to the nginx public folder
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# When the container starts, nginx will automatically serve the files
CMD ["nginx", "-g", "daemon off;"]