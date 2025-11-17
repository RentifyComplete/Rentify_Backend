const express = require("express");
const router = express.Router();
const User = require("../Modals/user");
const sendEmail = require("../utils/sendEmail");
const bcrypt = require("bcryptjs");

// ------------------------
// SEND RESET OTP
// ------------------------
router.post("/send-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "Email does not exist" });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.otp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000; // expires in 5 min
    await user.save();

    // Send OTP Email
    await sendEmail(
      email,
      "Rentify/RentOkPG Password Reset OTP",
      `Your OTP is: ${otp}\nThis OTP is valid for 5 minutes.`
    );

    res.json({ msg: "OTP sent successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Server error" });
  }
});

// ------------------------
// VERIFY OTP
// ------------------------
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.otp !== otp) {
      return res.status(400).json({ msg: "Invalid OTP" });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ msg: "OTP expired" });
    }

    res.json({ msg: "OTP verified" });

  } catch (error) {
    res.status(500).json({ msg: "Server error" });
  }
});

// ------------------------
// RESET PASSWORD
// ------------------------
router.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { email },
      {
        password: hashedPassword,
        otp: null,
        otpExpires: null
      }
    );

    res.json({ msg: "Password reset successful" });

  } catch (error) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
