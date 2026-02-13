'use client';
import { useEffect, useRef } from 'react';

export default function CameraStream() {
  const videoRef = useRef(null);

  useEffect(() => {
    let stream = null;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing webcam:', error);
      }
    };
    start();
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return <video ref={videoRef} autoPlay playsInline />;
}
