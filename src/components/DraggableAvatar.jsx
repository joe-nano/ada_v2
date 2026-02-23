import React, { useState, useRef, useEffect } from 'react';
import { Move } from 'lucide-react';

/**
 * DraggableAvatar - Floating draggable avatar container
 * Apple Vision Pro styled with glassmorphic design
 */
export function DraggableAvatar({ children, initialX, initialY, width, height }) {
  const [position, setPosition] = useState({
    x: initialX || window.innerWidth / 2,
    y: initialY || window.innerHeight / 2
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const avatarRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.target.closest('.drag-handle')) {
      setIsDragging(true);
      const rect = avatarRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      setPosition({ x: newX, y: newY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.target.closest('.drag-handle')) {
      setIsDragging(true);
      const touch = e.touches[0];
      const rect = avatarRef.current.getBoundingClientRect();
      setDragOffset({
        x: touch.clientX - rect.left - rect.width / 2,
        y: touch.clientY - rect.top - rect.height / 2
      });
    }
  };

  const handleTouchMove = (e) => {
    if (isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      const newX = touch.clientX - dragOffset.x;
      const newY = touch.clientY - dragOffset.y;
      setPosition({ x: newX, y: newY });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={avatarRef}
      className={`avatar-float glass spatial-card glass-shine depth-3 ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'auto',
        transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Drag Handle - Subtle Apple-style */}
      <div className="drag-handle absolute top-2 right-2 z-50 cursor-move opacity-0 hover:opacity-100 transition-opacity duration-200">
        <div className="glass p-2 rounded-full">
          <Move size={16} className="text-gray-500" />
        </div>
      </div>

      {/* Avatar Content */}
      <div className="relative w-full h-full">
        {children}
      </div>

      {/* Dragging Indicator */}
      {isDragging && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <div className="glass px-3 py-1 rounded-full text-xs text-gray-600 font-medium">
            Moving Avatar
          </div>
        </div>
      )}
    </div>
  );
}

export default DraggableAvatar;
