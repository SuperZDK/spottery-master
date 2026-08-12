"""轻量进程内 TTL + LRU 缓存（无第三方依赖）。"""
import threading
import time
from collections import OrderedDict
from typing import Any, Generic, Optional, Tuple, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    def __init__(self, ttl: float = 86400.0, maxsize: int = 4096) -> None:
        self._ttl = ttl
        self._maxsize = maxsize
        self._data: "OrderedDict[Any, Tuple[float, T]]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Any) -> Optional[T]:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at < time.monotonic():
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: Any, value: T) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + self._ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
