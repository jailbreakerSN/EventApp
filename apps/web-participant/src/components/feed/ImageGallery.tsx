"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageLightbox } from "./ImageLightbox";

interface ImageGalleryProps {
  images: string[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  const openLightbox = (index: number) => setLightboxIndex(index);

  return (
    <>
      <div className="mt-3 mb-4">
        {images.length === 1 && (
          <button
            onClick={() => openLightbox(0)}
            className="block w-full overflow-hidden rounded-lg"
            aria-label="Ouvrir l'image en grand"
          >
            <Image
              src={images[0]}
              alt="Image du post"
              width={600}
              height={400}
              className="w-full max-h-[400px] object-cover rounded-lg hover:opacity-95 transition-opacity"
              unoptimized
            />
          </button>
        )}

        {images.length === 2 && (
          <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
            {images.map((url, i) => (
              <button
                key={url}
                onClick={() => openLightbox(i)}
                className="overflow-hidden"
                aria-label={`Ouvrir l'image ${i + 1} en grand`}
              >
                <Image
                  src={url}
                  alt={`Image ${i + 1}`}
                  width={300}
                  height={300}
                  className="h-48 w-full object-cover hover:opacity-95 transition-opacity"
                  unoptimized
                />
              </button>
            ))}
          </div>
        )}

        {images.length === 3 && (
          <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
            <button
              onClick={() => openLightbox(0)}
              className="row-span-2 overflow-hidden"
              aria-label="Ouvrir l'image 1 en grand"
            >
              <Image
                src={images[0]}
                alt="Image 1"
                width={300}
                height={400}
                className="h-full w-full object-cover hover:opacity-95 transition-opacity"
                unoptimized
              />
            </button>
            {images.slice(1).map((url, i) => (
              <button
                key={url}
                onClick={() => openLightbox(i + 1)}
                className="overflow-hidden"
                aria-label={`Ouvrir l'image ${i + 2} en grand`}
              >
                <Image
                  src={url}
                  alt={`Image ${i + 2}`}
                  width={300}
                  height={200}
                  className="h-48 w-full object-cover hover:opacity-95 transition-opacity"
                  unoptimized
                />
              </button>
            ))}
          </div>
        )}

        {images.length >= 4 && (
          <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
            {images.slice(0, 4).map((url, i) => (
              <button
                key={url}
                onClick={() => openLightbox(i)}
                className="relative overflow-hidden"
                aria-label={`Ouvrir l'image ${i + 1} en grand`}
              >
                <Image
                  src={url}
                  alt={`Image ${i + 1}`}
                  width={300}
                  height={200}
                  className="h-48 w-full object-cover hover:opacity-95 transition-opacity"
                  unoptimized
                />
                {i === 3 && images.length > 4 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xl font-semibold">
                    +{images.length - 4}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
