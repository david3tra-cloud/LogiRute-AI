# Etapa 1: Build (Compilación)
FROM node:18-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Construir la aplicación React
RUN npm run build

# Etapa 2: Producción (Servicio)
FROM node:18-alpine

WORKDIR /app

# Instalar un servidor web para servir la aplicación estática
RUN npm install -g serve

# Copiar build desde la etapa anterior
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Exponer puerto
EXPOSE 8080

# Comando para servir la aplicación
CMD ["serve", "-s", "dist", "-l", "8080"]
