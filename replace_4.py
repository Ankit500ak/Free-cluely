# replace_4.py
"""
This script uses pyautogui to scan the current screen for the digit '4' using OCR (pytesseract),
and then moves the cursor to each '4' found and deletes it (by simulating backspace or delete).

Requirements:
    pip install pyautogui pillow pytesseract
    # You must also have Tesseract-OCR installed and in your PATH
"""
import pyautogui
import pytesseract
from PIL import Image
import time

# Take a screenshot
screenshot = pyautogui.screenshot()

# Use pytesseract to get bounding boxes for all digits
boxes = pytesseract.image_to_boxes(screenshot, config='--psm 6 -c tessedit_char_whitelist=0123456789')

# Find all '4' positions
fours = []
for line in boxes.splitlines():
    parts = line.split(' ')
    if len(parts) >= 5 and parts[0] == '4':
        char, x1, y1, x2, y2 = parts[:5]
        # Convert to screen coordinates
        x = (int(x1) + int(x2)) // 2
        y = screenshot.height - ((int(y1) + int(y2)) // 2)  # pytesseract y=0 is bottom
        fours.append((x, y))

print(f"Found {len(fours)} '4's on screen.")

# Move to each '4' and delete it
for (x, y) in fours:
    pyautogui.moveTo(x, y, duration=0.2)
    pyautogui.click()
    time.sleep(0.1)
    pyautogui.press('backspace')  # or 'delete' if needed
    time.sleep(0.1)

print("Done.")
