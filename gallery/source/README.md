# Gallery source

Drop original gallery media in this directory when developing locally. The build
pipeline also uses this directory as the destination for files synchronized from
the configured NAS share.

Supported inputs: JPEG, PNG, WebP, AVIF, HEIC/HEIF, TIFF, GIF and APNG. Static
images are converted to responsive WebP variants. Multi-frame inputs keep their
animation when converted to WebP.

Files may be nested in folders. The relative path and file name determine the
stable ordering and default title; use descriptive file names when possible.
