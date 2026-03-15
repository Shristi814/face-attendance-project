const express = require("express");
const app = express();
const PORT = 3000;

app.get("/check", (req, res) => {
  res.send("Test works!");
});

app.listen(PORT, () => console.log(`Test server running on http://localhost:${PORT}`));