const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "public", "index.html");
let content = fs.readFileSync(filePath);

// If there's no BOM, add one to force Windows and Chromium to read it as UTF-8
if (content[0] !== 0xef || content[1] !== 0xbb || content[2] !== 0xbf) {
  content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]);
  fs.writeFileSync(filePath, content);
  console.log("Added UTF-8 BOM to index.html");
} else {
  console.log("UTF-8 BOM already exists.");
}
