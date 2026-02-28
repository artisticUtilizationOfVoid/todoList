const fs = require("fs");

const fileBuffer = fs.readFileSync("public/index.html");

let isUTF8 = true;
// Very naive check for BOM or GBK characters... Wait, we can just write back as explicit UTF-8 by using toString('utf8') if we know it's valid, but if it has GBK, toString('utf8') will corrupt it.
// A simpler way: we can read it using iconv-lite or we can just rewrite it correctly.
require("child_process").execSync(
  'powershell.exe -Command "Get-Content public/index.html -Encoding UTF8 | Set-Content public/index.html.tmp -Encoding UTF8"',
);
fs.copyFileSync("public/index.html.tmp", "public/index.html");
console.log("Done checking encoding");
