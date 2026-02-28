const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// When running inside a pkg executable, __dirname points to a snapshot filesystem which is read-only.
// We use process.cwd() or process.execPath directory to define where the database should be stored on the real filesystem.
const isPkg = typeof process.pkg !== "undefined";

let dbFolder = __dirname;
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  // Portable version: next to the standalone .exe
  dbFolder = process.env.PORTABLE_EXECUTABLE_DIR;
} else if (process.env.USER_DATA_PATH) {
  // Installed electron AppData fallback
  dbFolder = process.env.USER_DATA_PATH;
} else if (isPkg) {
  // pkg builder fallback
  dbFolder = path.dirname(process.execPath);
}

const dbPath = path.join(dbFolder, "todo.db");

// Initialize SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database opening error: ", err);
  } else {
    // Enable foreign keys for cascading deletes
    db.run("PRAGMA foreign_keys = ON;", (pragmaErr) => {
      if (pragmaErr) console.error("Could not enable foreign keys", pragmaErr);
      db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS todos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              parent_id INTEGER,
              title TEXT NOT NULL,
              completed INTEGER DEFAULT 0,
              sort_order INTEGER DEFAULT 0,
              description TEXT DEFAULT '',
              priority INTEGER DEFAULT 0,
              due_date TEXT,
              FOREIGN KEY (parent_id) REFERENCES todos(id) ON DELETE CASCADE
            )
          `);
        // Add columns if they do not exist (migrations for existing db)
        db.run(
          `ALTER TABLE todos ADD COLUMN sort_order INTEGER DEFAULT 0`,
          (err) => {},
        );
        db.run(
          `ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''`,
          (err) => {},
        );
        db.run(
          `ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 0`,
          (err) => {},
        );
        db.run(`ALTER TABLE todos ADD COLUMN due_date TEXT`, (err) => {});

        // Settings table for persistence (e.g. intro_shown, preferences)
        db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `);
      });
    });
  }
});

// GET all todos
app.get("/api/todos", (req, res) => {
  db.all(
    "SELECT * FROM todos ORDER BY sort_order ASC, id ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    },
  );
});

// POST new todo
app.post("/api/todos", (req, res) => {
  const { title, parent_id, description, priority, due_date } = req.body;
  if (!title) return res.status(400).json({ error: "Title is required" });

  db.run(
    "INSERT INTO todos (title, parent_id, completed, sort_order, description, priority, due_date) VALUES (?, ?, 0, 0, ?, ?, ?)",
    [
      title,
      parent_id || null,
      description || "",
      priority || 0,
      due_date || null,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        title,
        parent_id: parent_id || null,
        completed: 0,
        sort_order: 0,
        description: description || "",
        priority: priority || 0,
        due_date: due_date || null,
      });
    },
  );
});

// PUT bulk reorder
app.put("/api/todos/reorder", (req, res) => {
  const { updates } = req.body; // Array of { id, parent_id, sort_order }
  if (!Array.isArray(updates))
    return res.status(400).json({ error: "Updates must be an array" });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare(
      "UPDATE todos SET parent_id = ?, sort_order = ? WHERE id = ?",
    );

    updates.forEach((u) => {
      stmt.run([u.parent_id || null, u.sort_order || 0, u.id]);
    });

    stmt.finalize();
    db.run("COMMIT", (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// PUT update todo and its children recursively (for status toggles)
app.put("/api/todos/:id/status-recursive", (req, res) => {
  const { completed } = req.body;
  const id = req.params.id;
  const newStatus = completed ? 1 : 0;

  // Use a recursive CTE to find the node and all its descendants, then update them
  const sql = `
    WITH RECURSIVE
      descendants(id) AS (
        SELECT id FROM todos WHERE id = ?
        UNION ALL
        SELECT t.id FROM todos t
        INNER JOIN descendants d ON t.parent_id = d.id
      )
    UPDATE todos 
    SET completed = ? 
    WHERE id IN (SELECT id FROM descendants);
  `;

  db.run(sql, [id, newStatus], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

// PUT update todo
app.put("/api/todos/:id", (req, res) => {
  const { title, completed, description, priority, due_date } = req.body;
  const id = req.params.id;

  const updates = [];
  const params = [];

  if (title !== undefined) {
    updates.push("title = ?");
    params.push(title);
  }
  if (completed !== undefined) {
    updates.push("completed = ?");
    params.push(completed ? 1 : 0);
  }
  if (description !== undefined) {
    updates.push("description = ?");
    params.push(description);
  }
  if (priority !== undefined) {
    updates.push("priority = ?");
    params.push(priority);
  }
  if (due_date !== undefined) {
    updates.push("due_date = ?");
    params.push(due_date);
  }

  if (updates.length === 0)
    return res.status(400).json({ error: "No update fields provided" });

  params.push(id);
  const sql = `UPDATE todos SET ${updates.join(", ")} WHERE id = ?`;

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

// DELETE todo (cascading deletes handled by SQLite ON DELETE CASCADE)
app.delete("/api/todos/:id", (req, res) => {
  const id = req.params.id;
  // Make sure foreign keys are enabled per-connection/query if not persistent,
  // but node-sqlite3 keeps a single connection so PRAGMA foreign_keys=ON is sufficient.
  db.run("PRAGMA foreign_keys = ON;", () => {
    db.run("DELETE FROM todos WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes });
    });
  });
});

// Settings API
app.get("/api/settings", (req, res) => {
  db.all("SELECT * FROM settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  });
});

app.post("/api/settings", (req, res) => {
  const settings = req.body; // { key: value }
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  db.serialize(() => {
    for (const key in settings) {
      stmt.run(key, String(settings[key]));
    }
    stmt.finalize();
  });
  res.json({ success: true });
});

const server = app.listen(process.env.PORT || 0, "127.0.0.1", () => {
  console.log(`Server started on http://127.0.0.1:${server.address().port}`);
});

module.exports = server;
