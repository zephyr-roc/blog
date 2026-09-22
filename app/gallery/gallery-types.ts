export type GallerySource = {
  src: string;
  width: number;
  type: "image/webp";
};

export type GalleryMetadata = {
  capturedAt: string | null;
  camera: string | null;
  lens: string | null;
  focalLength: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: string | null;
  format: string;
};

export type GalleryImage = {
  id: string;
  remoteId: string;
  sourceIndex: number;
  title: string;
  alt: string;
  width: number;
  height: number;
  animated: boolean;
  poster: string;
  original: string;
  sources: GallerySource[];
  metadata: GalleryMetadata;
};

export type GalleryManifest = {
  version: number;
  syncedAt: string;
  images: GalleryImage[];
};
