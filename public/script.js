const video = document.getElementById("video");
const statusText = document.getElementById("status");
const cameraStatus = document.getElementById("cameraStatus");
const resetBtn = document.getElementById("resetBtn");
const requestCameraBtn = document.getElementById("requestCameraBtn");
let attendanceMarked = false;
let faceMatcher = null;
let expressionModelAvailable = false;
const studentMapById = new Map();

// Initialize models
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    loadExpressionModelIfAvailable()
])
    .then(() => {
        console.log("✓ All models loaded");
        cameraStatus.textContent = "Starting camera...";
        startVideo();
    })
    .catch(err => {
        console.error("Error loading models:", err);
        showStatus("❌ Failed to load face detection models", "error");
        cameraStatus.textContent = "Error loading models";
    });

function startVideo() {
    const constraints = {
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
        },
        audio: false
    };

    console.log("🎥 Requesting camera permission...");
    cameraStatus.textContent = "📋 Please allow camera access in the permission dialog";
    cameraStatus.style.background = "#fef3c7";
    cameraStatus.style.color = "#92400e";
    cameraStatus.style.borderColor = "#f59e0b";

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            console.log("✓ Camera access granted");
            video.srcObject = stream;

            // Force video to play
            video.play().then(() => {
                console.log("✓ Video playing");
            }).catch(e => {
                console.error("Play error:", e);
            });

            cameraStatus.textContent = "✓ Camera Active";
            cameraStatus.style.background = "#dcfce7";
            cameraStatus.style.color = "#166534";
            cameraStatus.style.borderColor = "#10b981";
        })
        .catch(err => {
            console.error("Camera error:", err.name, err.message);

            let errorMsg = "❌ Camera access denied. ";
            if (err.name === "NotAllowedError") {
                errorMsg += "Please allow camera access in browser settings.";
            } else if (err.name === "NotFoundError") {
                errorMsg += "No camera device found.";
            } else if (err.name === "NotReadableError") {
                errorMsg += "Camera is in use by another application.";
            } else {
                errorMsg += err.message;
            }

            showStatus(errorMsg, "error");
            cameraStatus.textContent = "❌ Camera Access Denied";
            cameraStatus.style.background = "#fee2e2";
            cameraStatus.style.color = "#991b1b";
            cameraStatus.style.borderColor = "#ef4444";

            // Show request camera button
            requestCameraBtn.style.display = "inline-flex";
        });
}

// Add button click handler to request camera permission
requestCameraBtn.addEventListener("click", () => {
    console.log("User clicked 'Request Camera Access' button");
    requestCameraBtn.style.display = "none";
    startVideo();
});

video.addEventListener("play", async () => {
    try {
        const labeledDescriptors = await loadLabeledImages();

        if (labeledDescriptors.length === 0) {
            console.warn("No students found in database.");
            showStatus("⚠️ No registered students in database", "warning");
            return;
        }

        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
        showStatus("👁️ Waiting for face detection...", "default");

        // Run detection every 2 seconds
        setInterval(async () => {
            if (attendanceMarked) return;

            try {
                let detectionTask = faceapi.detectAllFaces(video)
                    .withFaceLandmarks()
                    .withFaceDescriptors();

                if (expressionModelAvailable) {
                    detectionTask = detectionTask.withFaceExpressions();
                }

                const detections = await detectionTask;

                if (detections.length === 0) {
                    showStatus("👁️ No face detected. Please look at the camera.", "default");
                    return;
                }

                detections.forEach(async (d) => {
                    if (attendanceMarked) return;

                    const bestMatch = faceMatcher.findBestMatch(d.descriptor);
                    const confidence = (1 - bestMatch.distance) * 100;
                    const expressionDetails = getExpressionDetails(d.expressions);
                    const matchedStudent = studentMapById.get(bestMatch.label);
                    const studentId = matchedStudent?._id || null;
                    const studentName = matchedStudent?.name || bestMatch.label;

                    if (bestMatch.label !== "unknown" && confidence > 40) {
                        console.log(`✓ Match found: ${studentName} (${confidence.toFixed(2)}%)`);
                        markAttendance(studentId, studentName, confidence, expressionDetails);
                    } else {
                        showStatus("🔍 Face not recognized. Please try again.", "default");
                    }
                });
            } catch (error) {
                console.error("Detection error:", error);
            }
        }, 2000);
    } catch (error) {
        console.error("Error:", error);
        showStatus("❌ An error occurred", "error");
    }
});

async function markAttendance(studentId, name, confidence, expressionDetails) {
    attendanceMarked = true;

    try {
        showStatus(`⏳ Marking attendance for ${name}...`, "default");

        const response = await fetch("/mark-attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                studentId,
                name,
                confidence,
                dominantExpression: expressionDetails?.dominantExpression,
                expressions: expressionDetails?.expressions || {}
            })
        });

        const data = await response.json();

        if (response.ok && response.status === 200) {
            showStatus(
                `✅ Attendance Marked!<br><strong>${name}</strong><br>Confidence: ${confidence.toFixed(1)}%<br>Expression: ${expressionDetails?.dominantExpression || "N/A"}`,
                "success"
            );
            resetBtn.style.display = "inline-flex";
        } else {
            showStatus(`❌ ${data.message || "Failed to mark attendance"}`, "error");
            attendanceMarked = false;
        }
    } catch (error) {
        console.error("Fetch error:", error);
        showStatus("❌ Failed to mark attendance", "error");
        attendanceMarked = false;
    }
}

function getExpressionDetails(expressions = {}) {
    const expressionEntries = Object.entries(expressions || {});

    if (expressionEntries.length === 0) {
        return {
            dominantExpression: null,
            expressions: {}
        };
    }

    const [dominantExpression] = expressionEntries.reduce((max, entry) => {
        return entry[1] > max[1] ? entry : max;
    });

    return {
        dominantExpression,
        expressions
    };
}

async function loadExpressionModelIfAvailable() {
    try {
        const manifestPath = "/models/face_expression_model-weights_manifest.json";
        const manifestResponse = await fetch(manifestPath, { method: "GET" });

        if (!manifestResponse.ok) {
            expressionModelAvailable = false;
            console.warn("Expression model not found. Continuing without expression detection.");
            return;
        }

        await faceapi.nets.faceExpressionNet.loadFromUri("/models");
        expressionModelAvailable = true;
        console.log("✓ Face expression model loaded");
    } catch (error) {
        expressionModelAvailable = false;
        console.warn("Expression model unavailable. Continuing without expression detection.", error);
    }
}

function showStatus(message, type = "default") {
    statusText.innerHTML = message;
    statusText.className = `status-message ${type}`;

    if (type === "success") {
        statusText.style.background = "#dcfce7";
        statusText.style.color = "#166534";
        statusText.style.borderColor = "#10b981";
    } else if (type === "error") {
        statusText.style.background = "#fee2e2";
        statusText.style.color = "#991b1b";
        statusText.style.borderColor = "#ef4444";
    } else if (type === "warning") {
        statusText.style.background = "#fef3c7";
        statusText.style.color = "#92400e";
        statusText.style.borderColor = "#f59e0b";
    } else {
        statusText.style.background = "var(--light-bg)";
        statusText.style.color = "var(--text-secondary)";
        statusText.style.borderColor = "var(--border-color)";
    }
}

resetBtn.addEventListener("click", () => {
    attendanceMarked = false;
    resetBtn.style.display = "none";
    showStatus("👁️ Waiting for face detection...", "default");
});

async function loadLabeledImages() {
    try {
        const res = await fetch("/students");

        if (!res.ok) {
            throw new Error("Failed to fetch students");
        }

        const students = await res.json();

        if (!Array.isArray(students)) {
            throw new Error("Invalid response format");
        }

        studentMapById.clear();

        return students.map(student => {
            const descriptorArray = Object.values(student.descriptor);
            const desc = new Float32Array(descriptorArray);
            const studentId = String(student._id);
            studentMapById.set(studentId, student);
            return new faceapi.LabeledFaceDescriptors(studentId, [desc]);
        });
    } catch (error) {
        console.error("Error loading labeled images:", error);
        showStatus("❌ Failed to load student database", "error");
        return [];
    }
}
