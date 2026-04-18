"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/browser";
import { Camera, CameraOff, SwitchCamera, Zap } from "lucide-react";

type ScannerState = "idle" | "requesting" | "scanning" | "denied" | "unavailable";

interface QrScannerProps {
  onScan: (value: string) => void;
  paused?: boolean;
}

export function QrScanner({ onScan, paused = false }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [state, setState] = useState<ScannerState>("idle");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraIndex, setActiveCameraIndex] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {
        // ignore
      }
      readerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startScanner = useCallback(
    async (cameraIndex: number) => {
      stopScanner();
      setState("requesting");

      let deviceList: MediaDeviceInfo[] = [];
      try {
        deviceList = await BrowserMultiFormatReader.listVideoInputDevices();
      } catch {
        setState("unavailable");
        return;
      }

      if (deviceList.length === 0) {
        setState("unavailable");
        return;
      }

      setCameras(deviceList);
      const safeIndex = Math.min(cameraIndex, deviceList.length - 1);
      setActiveCameraIndex(safeIndex);
      const deviceId = deviceList[safeIndex].deviceId;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, facingMode: "environment" },
          audio: false,
        });
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setState("denied");
        } else {
          setState("unavailable");
        }
        return;
      }

      streamRef.current = stream;

      // Detect torch support
      const videoTrack = stream.getVideoTracks()[0];
      const capabilities = videoTrack?.getCapabilities?.() as Record<string, unknown> | undefined;
      setTorchSupported(!!capabilities?.torch);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setState("scanning");

      try {
        await reader.decodeFromStream(stream, videoRef.current!, (result, err) => {
          if (result) {
            onScanRef.current(result.getText());
            if (navigator.vibrate) navigator.vibrate(100);
          }
          if (err && !(err instanceof NotFoundException)) {
            // Non-critical decode errors — ignore
          }
        });
      } catch {
        setState("unavailable");
      }
    },
    [stopScanner],
  );

  useEffect(() => {
    if (!paused) {
      startScanner(activeCameraIndex);
    } else {
      stopScanner();
      setState("idle");
    }
    return stopScanner;
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchCamera = () => {
    const next = (activeCameraIndex + 1) % cameras.length;
    setActiveCameraIndex(next);
    startScanner(next);
  };

  const handleToggleTorch = async () => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn((prev) => !prev);
    } catch {
      // torch apply failed silently
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-[4/3] flex items-center justify-center">
      {/* Video feed */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        aria-label="Flux vidéo du scanner QR"
      />

      {/* Scan frame overlay */}
      {state === "scanning" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-56 h-56">
            {/* Animated scan line */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="w-full h-0.5 bg-green-400/80 animate-scan-line" />
            </div>
            {/* Corner brackets */}
            {(["tl", "tr", "bl", "br"] as const).map((corner) => (
              <div
                key={corner}
                className={`absolute w-8 h-8 border-green-400 border-4 ${
                  corner === "tl" ? "top-0 left-0 border-r-0 border-b-0 rounded-tl-md" :
                  corner === "tr" ? "top-0 right-0 border-l-0 border-b-0 rounded-tr-md" :
                  corner === "bl" ? "bottom-0 left-0 border-r-0 border-t-0 rounded-bl-md" :
                  "bottom-0 right-0 border-l-0 border-t-0 rounded-br-md"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Status overlays */}
      {state === "requesting" && (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 text-white">
          <Camera className="h-10 w-10 animate-pulse" />
          <p className="text-sm font-medium">Accès à la caméra...</p>
        </div>
      )}
      {state === "denied" && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 text-white px-6 text-center">
          <CameraOff className="h-10 w-10 text-red-400" />
          <p className="text-sm font-medium">Accès à la caméra refusé</p>
          <p className="text-xs text-white/70">
            Autorisez l&apos;accès à la caméra dans les paramètres de votre navigateur, puis rechargez la page.
          </p>
        </div>
      )}
      {state === "unavailable" && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 text-white px-6 text-center">
          <CameraOff className="h-10 w-10 text-amber-400" />
          <p className="text-sm font-medium">Caméra non disponible</p>
          <p className="text-xs text-white/70">
            Aucune caméra détectée. Utilisez le mode manuel ci-dessous.
          </p>
        </div>
      )}

      {/* Camera controls */}
      {state === "scanning" && (
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          {cameras.length > 1 && (
            <button
              onClick={handleSwitchCamera}
              className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              aria-label="Changer de caméra"
              title="Changer de caméra"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          )}
          {torchSupported && (
            <button
              onClick={handleToggleTorch}
              className={`p-2 rounded-full transition-colors ${
                torchOn ? "bg-yellow-400 text-black" : "bg-black/50 text-white hover:bg-black/70"
              }`}
              aria-label={torchOn ? "Éteindre le flash" : "Allumer le flash"}
              title={torchOn ? "Éteindre le flash" : "Allumer le flash"}
            >
              <Zap className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
