const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema({
  content: { type: String, required: true },
  timestamp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Reminder", reminderSchema);
