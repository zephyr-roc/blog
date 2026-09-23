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

export type GalleryDetails = {
  width: number | null;
  height: number | null;
  fileSize: number | null;
  format: string | null;
  colorSpace: string | null;
  artist: string | null;
  copyright: string | null;
  software: string | null;
  timeZone: string | null;
  focalLength35mm: string | null;
  exposureBias: string | null;
  whiteBalance: string | null;
};

export type GalleryImage = {
  id: string;
  remoteId: string;
  sourceIndex: number;
  title: string;
  filename?: string;
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
