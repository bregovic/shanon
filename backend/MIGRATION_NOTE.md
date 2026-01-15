# Database Update Required

I have updated the attribute definitions as requested.
To apply these changes (delete old attributes, create new ones):

1. **Run the database installer script:**
   Open your browser and navigate to:
   `http://YOUR_SERVER/backend/install-db.php?token=shanon2026install`

   (Replace `YOUR_SERVER` with your actual backend address, usually `localhost` or `localhost/shanon`)

2. **Verify:**
   Go to **Settings -> Attributes** in the Shanon application. You should see the new list of attributes with Czech names.

## Changes Made
- Created migration `031_reset_attributes.sql`
- Registered migration in `install-db.php`
- Updated `cs.json` and `en.json` with attribute translations
- Updated `DmsReview.tsx` and `DmsSettings.tsx` to support translated attribute names
- Updated `DmsSettings.tsx` dialog to hide advanced fields and auto-generate codes.
