use tauri::Runtime;
use tauri_plugin_sql::{Migration, MigrationKind, SqlExt};

#[tauri::command]
async fn get_todos<R: Runtime>(app: tauri::AppHandle<R>) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    let sql = "SELECT * FROM todos ORDER BY sort_order ASC, id ASC";
    app.query(db, sql, vec![]).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_todo<R: Runtime>(
    app: tauri::AppHandle<R>,
    title: String,
    parent_id: Option<i32>,
    description: String,
    priority: i32,
    due_date: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    let sql = "INSERT INTO todos (title, parent_id, completed, sort_order, description, priority, due_date) VALUES (?, ?, 0, 0, ?, ?, ?)";
    app.execute(db, sql, vec![
        title.into(),
        parent_id.into(),
        description.into(),
        priority.into(),
        due_date.into(),
    ]).await.map_err(|e| e.to_string()).map(|_| serde_json::json!({}))
}

#[tauri::command]
async fn update_todo<R: Runtime>(app: tauri::AppHandle<R>, id: i32, data: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    let mut sets = Vec::new();
    let mut params = Vec::new();
    
    if let Some(t) = data.get("title") { sets.push("title = ?"); params.push(t.clone()); }
    if let Some(c) = data.get("completed") { 
        sets.push("completed = ?"); 
        params.push(c.clone());
        // Handle recursive status update (v1 port)
        let sql_recursive = "
            WITH RECURSIVE subordinates AS (
                SELECT id FROM todos WHERE id = ?
                UNION ALL
                SELECT t.id FROM todos t INNER JOIN subordinates s ON t.parent_id = s.id
            )
            UPDATE todos SET completed = ? WHERE id IN subordinates";
        let _ = app.execute(db, sql_recursive, vec![id.into(), c.clone()]).await;
    }
    if let Some(s) = data.get("sort_order") { sets.push("sort_order = ?"); params.push(s.clone()); }
    if let Some(p) = data.get("parent_id") { sets.push("parent_id = ?"); params.push(p.clone()); }
    if let Some(d) = data.get("description") { sets.push("description = ?"); params.push(d.clone()); }
    if let Some(pr) = data.get("priority") { sets.push("priority = ?"); params.push(pr.clone()); }
    if let Some(dd) = data.get("due_date") { sets.push("due_date = ?"); params.push(dd.clone()); }
    
    if sets.is_empty() { return Ok(serde_json::json!({})); }
    
    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    params.push(id.into());
    
    app.execute(db, &sql, params).await.map_err(|e| e.to_string()).map(|_| serde_json::json!({}))
}

#[tauri::command]
async fn reorder_todo<R: Runtime>(app: tauri::AppHandle<R>, id: i32, new_parent_id: Option<i32>, new_sort_order: i32) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    app.execute(db, "UPDATE todos SET parent_id = ?, sort_order = ? WHERE id = ?", vec![new_parent_id.into(), new_sort_order.into(), id.into()]).await.map_err(|e| e.to_string()).map(|_| serde_json::json!({}))
}

#[tauri::command]
async fn delete_todo<R: Runtime>(app: tauri::AppHandle<R>, id: i32) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    app.execute(db, "DELETE FROM todos WHERE id = ?", vec![id.into()]).await.map_err(|e| e.to_string()).map(|_| serde_json::json!({}))
}

#[tauri::command]
async fn get_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    app.query(db, "SELECT * FROM settings", vec![]).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_setting<R: Runtime>(app: tauri::AppHandle<R>, key: String, value: String) -> Result<serde_json::Value, String> {
    let db = "sqlite:todo.db";
    app.execute(db, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", vec![key.into(), value.into()]).await.map_err(|e| e.to_string()).map(|_| serde_json::json!({}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(
          "sqlite:todo.db",
          vec![Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
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
              );
              CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
              );",
            kind: MigrationKind::Up,
          }],
        )
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
        get_todos,
        create_todo,
        update_todo,
        delete_todo,
        get_settings,
        save_setting
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
