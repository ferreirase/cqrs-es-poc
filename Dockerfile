FROM node:lts

WORKDIR /app

COPY package*.json ./
COPY .env ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start:prod"]
