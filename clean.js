const fs = require("fs");
const path = require("path");

const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  const files = fs.readdirSync(distPath);
  for (const file of files) {
    if (file.endsWith(".exe") || file.endsWith(".blockmap")) {
      const filePath = path.join(distPath, file);
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted: ${file}`);
      } catch (err) {
        console.error(`Error deleting ${file}:`, err.message);
      }
    }
  }
} else {
  console.log("No dist directory found to clean.");
}
