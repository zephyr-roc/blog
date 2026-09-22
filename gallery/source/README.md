# Gallery runtime data

Gallery media is no longer synchronized during the image build. The production
container starts a background synchronizer after the web server becomes ready,
then checks the NAS share every 30 minutes.

Only 480px and 960px WebP thumbnails, a compact JSON manifest, and extracted
EXIF fields are retained in the persistent `/data/gallery` volume. Full-size
images remain on the NAS and are loaded by the visitor's browser through a
short-lived redirect token.

The synchronizer reuses entries by NAS photo ID, so periodic checks process only
new photos. The manifest is sorted by EXIF `DateTimeOriginal` from newest to
oldest, with NAS order used only when capture time is unavailable.
