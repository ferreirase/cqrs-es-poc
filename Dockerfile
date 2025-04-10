FROM node:lts

WORKDIR /app

# Instalar cliente PostgreSQL
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .env ./

# Instalar dependências
RUN npm install --legacy-peer-deps

# Copiar o código fonte
COPY . .

# Definir ambiente para produção
ENV NODE_ENV=production

# Construir a aplicação
RUN yarn build

# Debug - Listar estrutura da pasta dist
RUN find dist -type d | sort

# Garantir que os worker JS files sejam copiados para o diretório correto
RUN mkdir -p dist/src/common/workers
RUN cp -f src/common/workers/*.js dist/src/common/workers/ 2>/dev/null || echo "Não foram encontrados arquivos JS para copiar"

# Para garantir compatibilidade com ambos os caminhos possíveis
RUN mkdir -p dist/common/workers
RUN cp -f src/common/workers/*.js dist/common/workers/ 2>/dev/null || echo "Não foram encontrados arquivos JS para copiar"

# Garantir que config/db seja copiado para dist/config/db
RUN mkdir -p dist/config/db && cp -r config/db dist/config/

# Garantir que migrations seja copiado para o diretório de saída
RUN mkdir -p dist/src/database/migrations && cp -r src/database/migrations dist/src/database/

EXPOSE 3001

# Usar o caminho correto do arquivo main.js
CMD ["node", "dist/src/main.js"]
