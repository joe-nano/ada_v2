/**
 * Example: Custom spatial panel for JODA.
 *
 * This shows how to create a panel that floats in 3D space,
 * communicates with the backend via Socket.IO, and follows
 * JODA's panel conventions.
 *
 * To use:
 * 1. Save this as src/components/StocksWindow.jsx
 * 2. Add a position in SpatialPanel.jsx DEFAULT_POSITIONS:
 *      stocks: [-2, 2.5, -2]
 * 3. Import and render in the SpatialPanel component
 */

import React, { useState, useEffect, useCallback } from 'react';

export default function StocksWindow({ socket, onClose }) {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to stock updates from the backend
  useEffect(() => {
    if (!socket) return;

    const handleUpdate = (data) => {
      setStocks(data.stocks || []);
      setLoading(false);
    };

    socket.on('stocks_update', handleUpdate);

    // Request initial data
    socket.emit('get_stocks');

    return () => {
      socket.off('stocks_update', handleUpdate);
    };
  }, [socket]);

  // Refresh handler
  const refresh = useCallback(() => {
    setLoading(true);
    socket?.emit('get_stocks');
  }, [socket]);

  return (
    <div className="bg-black/80 backdrop-blur-md rounded-xl border border-white/10 p-4 text-white w-80 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Stocks</h2>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="text-xs px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
          >
            Refresh
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-white/50 text-sm py-4 text-center">Loading...</div>
      ) : stocks.length === 0 ? (
        <div className="text-white/50 text-sm py-4 text-center">No data</div>
      ) : (
        <div className="space-y-2">
          {stocks.map((stock) => (
            <div
              key={stock.symbol}
              className="flex items-center justify-between py-1 border-b border-white/5 last:border-0"
            >
              <div>
                <span className="font-mono font-bold">{stock.symbol}</span>
                <span className="text-white/40 text-xs ml-2">{stock.name}</span>
              </div>
              <div className="text-right">
                <div className="font-mono">${stock.price.toFixed(2)}</div>
                <div
                  className={`text-xs font-mono ${
                    stock.change >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {stock.change >= 0 ? '+' : ''}
                  {stock.change.toFixed(2)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
