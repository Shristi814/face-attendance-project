const video = document.getElementById("video");
const nameInput = document.getElementById("name");
const registerBtn = document.getElementById("registerBtn");
const registrationStatus = document.getElementById("registrationStatus");
const registerForm = document.getElementById("registerForm");
const requestCameraBtn = document.getElementById("requestCameraBtn");

let isCameraReady = false;
let expressionModelAvailable = false;

// Initialize models
Promise.all([
  faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
  faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
  loadExpressionModelIfAvailable()
])
  .then(() => {
    console.log("✓ All models loaded");
    startVideo();
  })
  .catch(err => {
    console.error("Error loading models:", err);
    showRegistrationStatus("❌ Failed to load face detection models", "error");
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
  showRegistrationStatus("📋 Please allow camera access in the permission dialog", "default");

  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      console.log("✓ Camera access granted");
      video.srcObject = stream;

      // Force video to play
      video.play().then(() => {
        console.log("✓ Video playing");
        isCameraReady = true;
        showRegistrationStatus("✓ Camera ready. Enter your name and click 'Capture & Register'", "default");
      }).catch(e => {
        console.error("Play error:", e);
        isCameraReady = true; // Still mark as ready even if autoplay fails
      });
    })
    .catch(err => {
      console.error("Camera error:", err.name, err.message);

      let errorMsg = "❌ Cannot access camera. ";
      if (err.name === "NotAllowedError") {
        errorMsg += "Please allow camera access in browser settings.";
      } else if (err.name === "NotFoundError") {
        errorMsg += "No camera device found.";
      } else if (err.name === "NotReadableError") {
        errorMsg += "Camera is in use by another application.";
      } else {
        errorMsg += err.message;
      }

      showRegistrationStatus(errorMsg, "error");
      registerBtn.disabled = true;
      isCameraReady = false;

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

registerBtn.addEventListener("click", async (e) => {
  e.preventDefault();

  if (!isCameraReady) {
    showRegistrationStatus("❌ Camera is not ready. Please refresh the page.", "error");
    return;
  }

  const name = nameInput.value.trim();

  if (!name) {
    showRegistrationStatus("❌ Please enter your name", "error");
    nameInput.focus();
    return;
  }

  if (name.length < 2) {
    showRegistrationStatus("❌ Name must be at least 2 characters long", "error");
    nameInput.focus();
    return;
  }

  registerBtn.disabled = true;
  showRegistrationStatus("⏳ Detecting face...", "default");

  try {
    let detectionTask = faceapi
      .detectSingleFace(video)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (expressionModelAvailable) {
      detectionTask = detectionTask.withFaceExpressions();
    }

    const detection = await detectionTask;

    if (!detection) {
      showRegistrationStatus("❌ No face detected! Please position your face clearly in the frame.", "error");
      registerBtn.disabled = false;
      return;
    }

    showRegistrationStatus("⏳ Registering face...", "default");

    const descriptor = Array.from(detection.descriptor);
    const expressionDetails = getExpressionDetails(detection.expressions);
    const photo = capturePhotoFromVideo(video);

    const response = await fetch("/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        descriptor,
        photo,
        dominantExpression: expressionDetails.dominantExpression,
        expressions: expressionDetails.expressions
      })
    });

    const data = await response.json();

    if (response.ok) {
      showRegistrationStatus(
        `✅ Success!<br><strong>${name}</strong> has been registered successfully.<br>Expression: ${expressionDetails.dominantExpression || "N/A"}<br>You can now use the attendance system.`,
        "success"
      );
      nameInput.value = "";
      nameInput.focus();
      setTimeout(() => {
        registerBtn.disabled = false;
        showRegistrationStatus("✓ Ready for next registration", "default");
      }, 2000);
    } else {
      showRegistrationStatus(`❌ Error: ${data.message || "Failed to register"}`, "error");
      registerBtn.disabled = false;
    }
  } catch (error) {
    console.error("Registration error:", error);
    showRegistrationStatus(
      `❌ Error: ${error.message || "An error occurred during registration"}`,
      "error"
    );
    registerBtn.disabled = false;
  }
});

function showRegistrationStatus(message, type = "default") {
  registrationStatus.innerHTML = message;

  if (type === "success") {
    registrationStatus.className = "registration-status success";
  } else if (type === "error") {
    registrationStatus.className = "registration-status error";
  } else {
    registrationStatus.className = "registration-status";
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

    await faceapi.nets.faceExpressionNet.loadFromUri('/models');
    expressionModelAvailable = true;
    console.log("✓ Face expression model loaded");
  } catch (error) {
    expressionModelAvailable = false;
    console.warn("Expression model unavailable. Continuing without expression detection.", error);
  }
}

function capturePhotoFromVideo(videoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoElement, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// Allow registration on Enter key
nameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !registerBtn.disabled) {
    registerBtn.click();
  }
});
