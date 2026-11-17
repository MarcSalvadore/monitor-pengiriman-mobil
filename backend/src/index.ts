import { createApp } from './app.js';
import { pool } from './db.js';

const PORT = Number(process.env.PORT || 3001);
const app = createApp(pool);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dealership Delivery API listening on port ${PORT}`);
});
