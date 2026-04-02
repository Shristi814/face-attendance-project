require('dotenv').config(); // ← Line 1, before everything

const express = require('express');
const mongoose = require('mongoose');
console.log("Server file loaded correctly!");

// ------------------------
// Import Dependencies
// ------------------------
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");

// ------------------------
// Initialize App
// ------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const DUPLICATE_FACE_THRESHOLD = 0.60;

// ------------------------
// Middleware
// ------------------------
app.use(cors());
app.use(bodyParser.json());

// ------------------------
// MongoDB Connection
// ------------------------
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("DB Connection Error:", err));

// ------------------------
// Mongoose Models
// ------------------------
const Student = mongoose.model("Student", new mongoose.Schema({
    name: String,
    descriptor: [Number], // Face descriptor array
    photo: String, // Base64 encoded photo
    createdAt: { type: Date, default: Date.now }
}));

const Attendance = mongoose.model("Attendance", new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    name: String,
    attendanceDate: String,
    confidence: Number,
    dominantExpression: String,
    expressions: { type: Object, default: {} },
    date: { type: Date, default: Date.now }
}));

const ExpressionLog = mongoose.model("ExpressionLog", new mongoose.Schema({
    name: String,
    source: { type: String, enum: ["register", "attendance"], default: "attendance" },
    dominantExpression: String,
    expressions: { type: Object, default: {} },
    date: { type: Date, default: Date.now }
}));

// ------------------------
// Routes
// ------------------------

// Health check route
app.get("/check", (req, res) => {
    res.send("Server is responding correctly");
});

// Get all students
app.get("/students", async (req, res) => {
    try {
        const students = await Student.find();
        res.json(students);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Delete a student
app.delete("/students/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ message: "Invalid student ID" });
        }

        const student = await Student.findByIdAndDelete(studentId);

        if (!student) {
            return res.status(404).json({ message: "Student not found" });
        }

        await Attendance.deleteMany({ studentId });
        await ExpressionLog.deleteMany({ name: student.name });

        res.json({
            message: `Student ${student.name} and their records deleted successfully`
        });
    } catch (err) {
        res.status(500).json(err);
    }
});

// Register a new student
app.post("/register", async (req, res) => {
    try {
        const { name, descriptor, photo, dominantExpression, expressions } = req.body;

        if (!name || !Array.isArray(descriptor) || descriptor.length === 0) {
            return res.status(400).json({ message: "Name and valid face descriptor are required" });
        }

        const normalizedDescriptor = descriptor.map((value) => Number(value));
        const existingStudents = await Student.find({}, { name: 1, descriptor: 1 });

        const duplicateStudent = existingStudents.find((student) => {
            if (!Array.isArray(student.descriptor) || student.descriptor.length !== descriptor.length) {
                return false;
            }

            const studentDescriptor = student.descriptor.map((value) => Number(value));
            const distance = euclideanDistance(studentDescriptor, normalizedDescriptor);
            return distance <= DUPLICATE_FACE_THRESHOLD;
        });

        if (duplicateStudent) {
            return res.status(409).json({
                message: `Face already registered as ${duplicateStudent.name}`
            });
        }

        const student = new Student({ name, descriptor: normalizedDescriptor, photo });
        await student.save();

        if (dominantExpression || expressions) {
            const expressionLog = new ExpressionLog({
                name,
                source: "register",
                dominantExpression,
                expressions: expressions || {}
            });
            await expressionLog.save();
        }

        res.json({ message: "Student registered successfully" });
    } catch (err) {
        res.status(500).json(err);
    }
});

// Mark attendance
app.post("/mark-attendance", async (req, res) => {
    const { studentId, name, confidence, dominantExpression, expressions } = req.body;

    if (!name) {
        return res.status(400).json({ message: "Name is required" });
    }

    const now = new Date();
    const attendanceDate = getAttendanceDateKey(now);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const hasValidStudentId = studentId && mongoose.Types.ObjectId.isValid(studentId);

    let existing = null;

    if (hasValidStudentId) {
        existing = await Attendance.findOne({ studentId, attendanceDate });
    }

    if (!existing) {
        existing = await Attendance.findOne({
            name,
            date: { $gte: startOfDay, $lte: endOfDay }
        });
    }

    if (existing) {
        return res.status(409).json({ message: "Attendance already marked today" });
    }

    const attendance = new Attendance({
        studentId: hasValidStudentId ? studentId : undefined,
        name,
        attendanceDate,
        confidence,
        dominantExpression,
        expressions: expressions || {},
        date: now
    });

    await attendance.save();

    if (dominantExpression || expressions) {
        const expressionLog = new ExpressionLog({
            name,
            source: "attendance",
            dominantExpression,
            expressions: expressions || {},
            date: new Date()
        });
        await expressionLog.save();
    }

    res.json({ message: "Attendance marked successfully" });
});

// Get all attendance history
app.get("/attendance-history", async (req, res) => {
    try {
        const attendance = await Attendance.find().sort({ date: -1 });
        res.json(attendance);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Get all facial expression history
app.get("/expression-history", async (req, res) => {
    try {
        const expressions = await ExpressionLog.find().sort({ date: -1 });
        res.json(expressions);
    } catch (err) {
        res.status(500).json(err);
    }
});

// Get complete dashboard data (no login required)
app.get("/dashboard-data", async (req, res) => {
    try {
        const [students, attendanceHistory, expressionHistory] = await Promise.all([
            Student.find().sort({ createdAt: -1 }),
            Attendance.find().sort({ date: -1 }),
            ExpressionLog.find().sort({ date: -1 })
        ]);

        const latestExpressionByName = new Map();
        expressionHistory.forEach((entry) => {
            if (!latestExpressionByName.has(entry.name)) {
                latestExpressionByName.set(entry.name, entry);
            }
        });

        const attendanceCountByName = attendanceHistory.reduce((acc, item) => {
            acc[item.name] = (acc[item.name] || 0) + 1;
            return acc;
        }, {});

        const registeredStudents = students.map((student) => {
            const latestExpression = latestExpressionByName.get(student.name);
            return {
                _id: student._id,
                name: student.name,
                createdAt: student.createdAt,
                photo: student.photo || null,
                totalAttendance: attendanceCountByName[student.name] || 0,
                latestExpression: latestExpression ? {
                    dominantExpression: latestExpression.dominantExpression,
                    expressions: latestExpression.expressions,
                    source: latestExpression.source,
                    date: latestExpression.date
                } : null
            };
        });

        res.json({
            totals: {
                students: students.length,
                attendanceRecords: attendanceHistory.length,
                expressionRecords: expressionHistory.length
            },
            registeredStudents,
            attendanceHistory,
            expressionHistory
        });
    } catch (err) {
        res.status(500).json(err);
    }
});



// ------------------------
// Serve Static Files
// ------------------------
app.use(express.static(path.join(__dirname, "public"))); // Serve public folder after routes

// ------------------------
// Start Server
// ------------------------
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

function euclideanDistance(vectorA, vectorB) {
    let sum = 0;

    for (let index = 0; index < vectorA.length; index += 1) {
        const delta = Number(vectorA[index]) - Number(vectorB[index]);
        sum += delta * delta;
    }

    return Math.sqrt(sum);
}

function getAttendanceDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
