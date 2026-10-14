import 'dotenv/config';
import cors from 'cors';
import express from 'express';

const app = express();
const port = Number(process.env.PORT) || 3333;

app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`API disponível em http://localhost:${port}`);
});
