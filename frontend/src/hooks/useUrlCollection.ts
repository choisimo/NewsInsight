import { useState, useCallback, useEffect } from 'react';

// ============================================
// Types
// ============================================

export interface UrlItem {
  id: string;
  type: 'url';
  name: string;
  url: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  lastAnalyzedAt?: string;
}

export interface FolderItem {
  id: string;
  type: 'folder';
  name: string;
  description?: string;
  children: (UrlItem | FolderItem)[];
  isExpanded?: boolean;
  createdAt: string;
}

export type TreeItem = UrlItem | FolderItem;

export interface UrlCollection {
  version: string;
  name: string;
  description?: string;
  root: FolderItem;
  createdAt: string;
  updatedAt: string;
}

export interface SelectedItems {
  folders: Set<string>;
  urls: Set<string>;
}

// ============================================
// Utility Functions
// ============================================

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const createDefaultCollection = (): UrlCollection => ({
  version: '1.0',
  name: 'My URL Collection',
  description: 'URL collection for news analysis',
  root: {
    id: 'root',
    type: 'folder',
    name: 'Root',
    children: [],
    isExpanded: true,
    createdAt: new Date().toISOString(),
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const STORAGE_KEY = 'newsinsight-url-collection';

// Deep clone utility
const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

// Find item in tree
const findItemInTree = (
  items: TreeItem[],
  id: string
): { item: TreeItem; parent: FolderItem | null; index: number } | null => {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.id === id) {
      return { item, parent: null, index: i };
    }
    if (item.type === 'folder') {
      const found = findItemInTree(item.children, id);
      if (found) {
        if (found.parent === null) {
          found.parent = item;
        }
        return found;
      }
    }
  }
  return null;
};

// Find folder by id
const findFolderById = (items: TreeItem[], id: string): FolderItem | null => {
  for (const item of items) {
    if (item.id === id && item.type === 'folder') {
      return item;
    }
    if (item.type === 'folder') {
      const found = findFolderById(item.children, id);
      if (found) return found;
    }
  }
  return null;
};

// Get all URLs from selected items (including nested)
const getAllUrlsFromItems = (items: TreeItem[], selectedFolders: Set<string>, selectedUrls: Set<string>): UrlItem[] => {
  const urls: UrlItem[] = [];
  
  const collectUrls = (item: TreeItem) => {
    if (item.type === 'url') {
      if (selectedUrls.has(item.id)) {
        urls.push(item);
      }
    } else {
      // If folder is selected, collect all URLs inside
      if (selectedFolders.has(item.id)) {
        const collectAllNested = (folder: FolderItem) => {
          for (const child of folder.children) {
            if (child.type === 'url') {
              urls.push(child);
            } else {
              collectAllNested(child);
            }
          }
        };
        collectAllNested(item);
      } else {
        // Check nested items
        for (const child of item.children) {
          collectUrls(child);
        }
      }
    }
  };

  for (const item of items) {
    collectUrls(item);
  }

  return urls;
};

// ============================================
// Hook
// ============================================

export function useUrlCollection() {
  const [collection, setCollection] = useState<UrlCollection>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load URL collection from storage:', e);
    }
    return createDefaultCollection();
  });

  const [selectedItems, setSelectedItems] = useState<SelectedItems>({
    folders: new Set(),
    urls: new Set(),
  });

  // Save to localStorage whenever collection changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    } catch (e) {
      console.error('Failed to save URL collection:', e);
    }
  }, [collection]);

  // Update collection timestamp
  const updateCollection = useCallback((updater: (col: UrlCollection) => UrlCollection) => {
    setCollection(prev => {
      const updated = updater(deepClone(prev));
      updated.updatedAt = new Date().toISOString();
      return updated;
    });
  }, []);

  // Add folder
  const addFolder = useCallback((parentId: string, name: string, description?: string) => {
    const newFolder: FolderItem = {
      id: generateId(),
      type: 'folder',
      name,
      description,
      children: [],
      isExpanded: true,
      createdAt: new Date().toISOString(),
    };

    updateCollection(col => {
      if (parentId === 'root') {
        col.root.children.push(newFolder);
      } else {
        const parent = findFolderById([col.root], parentId);
        if (parent) {
          parent.children.push(newFolder);
        }
      }
      return col;
    });

    return newFolder.id;
  }, [updateCollection]);

  // Add URL
  const addUrl = useCallback((
    parentId: string,
    url: string,
    name?: string,
    description?: string,
    tags?: string[]
  ) => {
    const newUrl: UrlItem = {
      id: generateId(),
      type: 'url',
      name: name || new URL(url).hostname,
      url,
      description,
      tags,
      createdAt: new Date().toISOString(),
    };

    updateCollection(col => {
      if (parentId === 'root') {
        col.root.children.push(newUrl);
      } else {
        const parent = findFolderById([col.root], parentId);
        if (parent) {
          parent.children.push(newUrl);
        }
      }
      return col;
    });

    return newUrl.id;
  }, [updateCollection]);

  // Add multiple URLs at once
  const addUrls = useCallback((
    parentId: string,
    urls: Array<{ url: string; name?: string; description?: string; tags?: string[] }>
  ) => {
    updateCollection(col => {
      const parent = parentId === 'root' 
        ? col.root 
        : findFolderById([col.root], parentId);
      
      if (parent) {
        for (const urlData of urls) {
          const newUrl: UrlItem = {
            id: generateId(),
            type: 'url',
            name: urlData.name || new URL(urlData.url).hostname,
            url: urlData.url,
            description: urlData.description,
            tags: urlData.tags,
            createdAt: new Date().toISOString(),
          };
          parent.children.push(newUrl);
        }
      }
      return col;
    });
  }, [updateCollection]);

  // Update item
  const updateItem = useCallback((id: string, updates: Partial<UrlItem | FolderItem>) => {
    updateCollection(col => {
      const found = findItemInTree([col.root], id);
      if (found) {
        Object.assign(found.item, updates);
      }
      return col;
    });
  }, [updateCollection]);

  // Delete item
  const deleteItem = useCallback((id: string) => {
    updateCollection(col => {
      const removeFromChildren = (children: TreeItem[]): TreeItem[] => {
        return children.filter(child => {
          if (child.id === id) return false;
          if (child.type === 'folder') {
            child.children = removeFromChildren(child.children);
          }
          return true;
        });
      };
      col.root.children = removeFromChildren(col.root.children);
      return col;
    });

    // Remove from selection
    setSelectedItems(prev => {
      const newFolders = new Set(prev.folders);
      const newUrls = new Set(prev.urls);
      newFolders.delete(id);
      newUrls.delete(id);
      return { folders: newFolders, urls: newUrls };
    });
  }, [updateCollection]);

  // Move item to new parent
  const moveItem = useCallback((itemId: string, newParentId: string) => {
    updateCollection(col => {
      // Find and remove item from current location
      let itemToMove: TreeItem | null = null;
      
      const removeFromChildren = (children: TreeItem[]): TreeItem[] => {
        return children.filter(child => {
          if (child.id === itemId) {
            itemToMove = child;
            return false;
          }
          if (child.type === 'folder') {
            child.children = removeFromChildren(child.children);
          }
          return true;
        });
      };
      
      col.root.children = removeFromChildren(col.root.children);

      // Add to new parent
      if (itemToMove) {
        const newParent = newParentId === 'root' 
          ? col.root 
          : findFolderById([col.root], newParentId);
        if (newParent) {
          newParent.children.push(itemToMove);
        }
      }

      return col;
    });
  }, [updateCollection]);

  // Toggle folder expansion
  const toggleFolder = useCallback((id: string) => {
    updateCollection(col => {
      const folder = findFolderById([col.root], id);
      if (folder) {
        folder.isExpanded = !folder.isExpanded;
      }
      return col;
    });
  }, [updateCollection]);

  // Toggle item selection
  const toggleSelection = useCallback((id: string, type: 'folder' | 'url') => {
    setSelectedItems(prev => {
      const set = type === 'folder' ? new Set(prev.folders) : new Set(prev.urls);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return type === 'folder' 
        ? { ...prev, folders: set }
        : { ...prev, urls: set };
    });
  }, []);

  // Select all in folder
  const selectAllInFolder = useCallback((folderId: string) => {
    const folder = folderId === 'root' 
      ? collection.root 
      : findFolderById([collection.root], folderId);
    
    if (!folder) return;

    setSelectedItems(prev => {
      const newUrls = new Set(prev.urls);
      const newFolders = new Set(prev.folders);

      const selectRecursive = (f: FolderItem) => {
        for (const child of f.children) {
          if (child.type === 'url') {
            newUrls.add(child.id);
          } else {
            newFolders.add(child.id);
            selectRecursive(child);
          }
        }
      };

      selectRecursive(folder);
      return { folders: newFolders, urls: newUrls };
    });
  }, [collection.root]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedItems({ folders: new Set(), urls: new Set() });
  }, []);

  // Get selected URLs (flattened)
  const getSelectedUrls = useCallback((): UrlItem[] => {
    return getAllUrlsFromItems(
      [collection.root],
      selectedItems.folders,
      selectedItems.urls
    );
  }, [collection.root, selectedItems]);

  // Export to JSON
  const exportToJson = useCallback((): string => {
    return JSON.stringify(collection, null, 2);
  }, [collection]);

  // Export selected to JSON
  const exportSelectedToJson = useCallback((): string => {
    const selectedUrls = getSelectedUrls();
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      urls: selectedUrls.map(u => ({
        name: u.name,
        url: u.url,
        description: u.description,
        tags: u.tags,
      })),
    };
    return JSON.stringify(exportData, null, 2);
  }, [getSelectedUrls]);

  // Import from JSON
  const importFromJson = useCallback((jsonString: string, targetFolderId: string = 'root') => {
    try {
      const data = JSON.parse(jsonString);
      
      // Check if it's a full collection or just URLs
      if (data.version && data.root) {
        // Full collection import - replace everything
        setCollection({
          ...data,
          updatedAt: new Date().toISOString(),
        });
      } else if (data.urls && Array.isArray(data.urls)) {
        // URL list import - add to target folder
        addUrls(targetFolderId, data.urls);
      } else if (Array.isArray(data)) {
        // Simple URL array
        const urls = data.map((item: any) => ({
          url: typeof item === 'string' ? item : item.url,
          name: typeof item === 'string' ? undefined : item.name,
          description: typeof item === 'string' ? undefined : item.description,
          tags: typeof item === 'string' ? undefined : item.tags,
        }));
        addUrls(targetFolderId, urls);
      }
      return true;
    } catch (e) {
      console.error('Failed to import JSON:', e);
      return false;
    }
  }, [addUrls]);

  // Reset to default
  const resetCollection = useCallback(() => {
    setCollection(createDefaultCollection());
    clearSelection();
  }, [clearSelection]);

  // Mark URLs as analyzed
  const markAsAnalyzed = useCallback((urlIds: string[]) => {
    const now = new Date().toISOString();
    updateCollection(col => {
      const updateRecursive = (items: TreeItem[]) => {
        for (const item of items) {
          if (item.type === 'url' && urlIds.includes(item.id)) {
            item.lastAnalyzedAt = now;
          } else if (item.type === 'folder') {
            updateRecursive(item.children);
          }
        }
      };
      updateRecursive([col.root]);
      return col;
    });
  }, [updateCollection]);

  // Check if a URL already exists in the collection
  const urlExists = useCallback((url: string): boolean => {
    const checkRecursive = (items: TreeItem[]): boolean => {
      for (const item of items) {
        if (item.type === 'url' && item.url === url) {
          return true;
        } else if (item.type === 'folder') {
          if (checkRecursive(item.children)) {
            return true;
          }
        }
      }
      return false;
    };
    return checkRecursive([collection.root]);
  }, [collection.root]);

  // Get all URLs in the collection (flattened)
  const getAllUrls = useCallback((): UrlItem[] => {
    const urls: UrlItem[] = [];
    const collectRecursive = (items: TreeItem[]) => {
      for (const item of items) {
        if (item.type === 'url') {
          urls.push(item);
        } else if (item.type === 'folder') {
          collectRecursive(item.children);
        }
      }
    };
    collectRecursive([collection.root]);
    return urls;
  }, [collection.root]);

  return {
    collection,
    selectedItems,
    selectedCount: selectedItems.folders.size + selectedItems.urls.size,
    
    // CRUD operations
    addFolder,
    addUrl,
    addUrls,
    updateItem,
    deleteItem,
    moveItem,
    
    // UI state
    toggleFolder,
    toggleSelection,
    selectAllInFolder,
    clearSelection,
    
    // Data access
    getSelectedUrls,
    urlExists,
    getAllUrls,
    
    // Import/Export
    exportToJson,
    exportSelectedToJson,
    importFromJson,
    
    // Misc
    resetCollection,
    markAsAnalyzed,
  };
}

export default useUrlCollection;
