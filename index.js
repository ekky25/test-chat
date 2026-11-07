const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('API calisiyor');
});

app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} uzerinde aktif`);
});