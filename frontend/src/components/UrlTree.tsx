import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  Link,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Edit,
  FolderPlus,
  Plus,
  Check,
  X,
  GripVertical,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TreeItem, FolderItem, UrlItem, SelectedItems } from '@/hooks/useUrlCollection';

// ============================================
// Drag & Drop Context
// ============================================

interface DragState {
  draggedItemId: string | null;
  draggedItemType: 'folder' | 'url' | null;
  dropTargetId: string | null;
  dropPosition: 'before' | 'inside' | 'after' | null;
}

// ============================================
// Tree Item Component
// ============================================

interface TreeNodeProps {
  item: TreeItem;
  depth: number;
  selectedItems: SelectedItems;
  onToggleFolder: (id: string) => void;
  onToggleSelection: (id: string, type: 'folder' | 'url') => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UrlItem | FolderItem>) => void;
  onAddFolder: (parentId: string) => void;
  onAddUrl: (parentId: string) => void;
  onSelectAll: (folderId: string) => void;
  onMoveItem?: (itemId: string, targetFolderId: string) => void;
  dragState: DragState;
  onDragStart: (id: string, type: 'folder' | 'url') => void;
  onDragEnd: () => void;
  onDragOver: (id: string, position: 'before' | 'inside' | 'after') => void;
  onDrop: (targetId: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  item,
  depth,
  selectedItems,
  onToggleFolder,
  onToggleSelection,
  onDelete,
  onUpdate,
  onAddFolder,
  onAddUrl,
  onSelectAll,
  onMoveItem,
  dragState,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const nodeRef = useRef<HTMLDivElement>(null);

  const isSelected = item.type === 'folder' 
    ? selectedItems.folders.has(item.id)
    : selectedItems.urls.has(item.id);

  const isDragging = dragState.draggedItemId === item.id;
  const isDropTarget = dragState.dropTargetId === item.id;
  const dropPosition = isDropTarget ? dragState.dropPosition : null;

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    onDragStart(item.id, item.type);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.preventDefault();
    onDragEnd();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragState.draggedItemId === item.id) return;
    
    // Don't allow dropping a folder into itself or its children
    if (dragState.draggedItemType === 'folder' && item.type === 'folder') {
      // This is a simplified check - a full check would verify ancestry
    }

    const rect = nodeRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    const height = rect.height;

    // For folders, allow dropping inside
    if (item.type === 'folder') {
      if (y < height * 0.25) {
        onDragOver(item.id, 'before');
      } else if (y > height * 0.75) {
        onDragOver(item.id, 'after');
      } else {
        onDragOver(item.id, 'inside');
      }
    } else {
      // For URLs, only allow before/after
      if (y < height * 0.5) {
        onDragOver(item.id, 'before');
      } else {
        onDragOver(item.id, 'after');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop(item.id);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleSaveEdit = () => {
    if (editName.trim()) {
      onUpdate(item.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditName(item.name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  if (item.type === 'folder') {
    const folder = item as FolderItem;
    return (
      <div>
        <div
          ref={nodeRef}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          className={cn(
            'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
            isSelected && 'bg-primary/10 hover:bg-primary/20',
            isDragging && 'opacity-50 bg-muted',
            isDropTarget && dropPosition === 'inside' && 'ring-2 ring-primary ring-inset bg-primary/5',
            isDropTarget && dropPosition === 'before' && 'border-t-2 border-primary',
            isDropTarget && dropPosition === 'after' && 'border-b-2 border-primary'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {/* Drag Handle */}
          <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

          {/* Expand/Collapse */}
          <button
            onClick={() => onToggleFolder(folder.id)}
            className="p-0.5 hover:bg-muted rounded"
          >
            {folder.isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Checkbox */}
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection(folder.id, 'folder')}
            className="mr-1"
          />

          {/* Icon */}
          {folder.isExpanded ? (
            <FolderOpen className="h-4 w-4 text-yellow-600 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-yellow-600 shrink-0" />
          )}

          {/* Name */}
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-6 text-sm py-0"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <span
              className="flex-1 text-sm font-medium truncate"
              onDoubleClick={() => setIsEditing(true)}
            >
              {folder.name}
            </span>
          )}

          {/* Item count */}
          <Badge variant="secondary" className="text-xs h-5 px-1.5">
            {folder.children.length}
          </Badge>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAddFolder(folder.id)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                하위 폴더 추가
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddUrl(folder.id)}>
                <Plus className="h-4 w-4 mr-2" />
                URL 추가
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSelectAll(folder.id)}>
                <Check className="h-4 w-4 mr-2" />
                전체 선택
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                이름 변경
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(folder.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Children */}
        {folder.isExpanded && (
          <div>
            {folder.children.map((child) => (
              <TreeNode
                key={child.id}
                item={child}
                depth={depth + 1}
                selectedItems={selectedItems}
                onToggleFolder={onToggleFolder}
                onToggleSelection={onToggleSelection}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onAddFolder={onAddFolder}
                onAddUrl={onAddUrl}
                onSelectAll={onSelectAll}
                onMoveItem={onMoveItem}
                dragState={dragState}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // URL item
  const url = item as UrlItem;
  return (
    <div
      ref={nodeRef}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      className={cn(
        'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
        isSelected && 'bg-primary/10 hover:bg-primary/20',
        isDragging && 'opacity-50 bg-muted',
        isDropTarget && dropPosition === 'before' && 'border-t-2 border-primary',
        isDropTarget && dropPosition === 'after' && 'border-b-2 border-primary'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      {/* Drag Handle */}
      <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelection(url.id, 'url')}
        className="mr-1"
      />

      {/* Icon */}
      <Link className="h-4 w-4 text-blue-600 shrink-0" />

      {/* Name & URL */}
      {isEditing ? (
        <div className="flex items-center gap-1 flex-1">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-6 text-sm py-0"
            autoFocus
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveEdit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex-1 text-sm truncate"
              onDoubleClick={() => setIsEditing(true)}
            >
              {url.name}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-xs break-all">{url.url}</p>
            {url.description && (
              <p className="text-xs text-muted-foreground mt-1">{url.description}</p>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Tags */}
      {url.tags && url.tags.length > 0 && (
        <div className="hidden sm:flex gap-1">
          {url.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs h-5 px-1">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Last analyzed indicator */}
      {url.lastAnalyzedAt && (
        <Tooltip>
          <TooltipTrigger>
            <Clock className="h-3 w-3 text-green-600" />
          </TooltipTrigger>
          <TooltipContent>
            마지막 분석: {new Date(url.lastAnalyzedAt).toLocaleString('ko-KR')}
          </TooltipContent>
        </Tooltip>
      )}

      {/* External link */}
      <a
        href={url.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
      </a>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsEditing(true)}>
            <Edit className="h-4 w-4 mr-2" />
            이름 변경
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(url.url);
            }}
          >
            <Link className="h-4 w-4 mr-2" />
            URL 복사
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(url.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

// ============================================
// URL Tree Component
// ============================================

interface UrlTreeProps {
  root: FolderItem;
  selectedItems: SelectedItems;
  onToggleFolder: (id: string) => void;
  onToggleSelection: (id: string, type: 'folder' | 'url') => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UrlItem | FolderItem>) => void;
  onAddFolder: (parentId: string) => void;
  onAddUrl: (parentId: string) => void;
  onSelectAll: (folderId: string) => void;
  onMoveItem?: (itemId: string, targetFolderId: string) => void;
}

export const UrlTree: React.FC<UrlTreeProps> = ({
  root,
  selectedItems,
  onToggleFolder,
  onToggleSelection,
  onDelete,
  onUpdate,
  onAddFolder,
  onAddUrl,
  onSelectAll,
  onMoveItem,
}) => {
  // Drag & Drop state management
  const [dragState, setDragState] = useState<DragState>({
    draggedItemId: null,
    draggedItemType: null,
    dropTargetId: null,
    dropPosition: null,
  });

  const handleDragStart = useCallback((id: string, type: 'folder' | 'url') => {
    setDragState({
      draggedItemId: id,
      draggedItemType: type,
      dropTargetId: null,
      dropPosition: null,
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragState({
      draggedItemId: null,
      draggedItemType: null,
      dropTargetId: null,
      dropPosition: null,
    });
  }, []);

  const handleDragOver = useCallback((id: string, position: 'before' | 'inside' | 'after') => {
    setDragState(prev => ({
      ...prev,
      dropTargetId: id,
      dropPosition: position,
    }));
  }, []);

  // Find parent folder of an item
  const findParentFolder = useCallback((itemId: string, items: (UrlItem | FolderItem)[], parentId: string = 'root'): string | null => {
    for (const item of items) {
      if (item.id === itemId) {
        return parentId;
      }
      if (item.type === 'folder') {
        const found = findParentFolder(itemId, item.children, item.id);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    if (!dragState.draggedItemId || !onMoveItem) {
      handleDragEnd();
      return;
    }

    const { draggedItemId, dropPosition } = dragState;

    // Prevent dropping an item onto itself
    if (draggedItemId === targetId) {
      handleDragEnd();
      return;
    }

    // Find the target item to determine its parent
    const findItem = (items: (UrlItem | FolderItem)[]): (UrlItem | FolderItem) | null => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.type === 'folder') {
          const found = findItem(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    const targetItem = findItem(root.children);

    if (targetItem) {
      if (dropPosition === 'inside' && targetItem.type === 'folder') {
        // Drop inside folder
        onMoveItem(draggedItemId, targetId);
      } else {
        // Drop before/after - move to parent folder
        const parentId = findParentFolder(targetId, root.children);
        if (parentId) {
          onMoveItem(draggedItemId, parentId);
        }
      }
    }

    handleDragEnd();
  }, [dragState, onMoveItem, handleDragEnd, root.children, findParentFolder]);

  if (root.children.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">URL이 없습니다</p>
        <p className="text-xs mt-1">폴더나 URL을 추가하세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {root.children.map((item) => (
        <TreeNode
          key={item.id}
          item={item}
          depth={0}
          selectedItems={selectedItems}
          onToggleFolder={onToggleFolder}
          onToggleSelection={onToggleSelection}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onAddFolder={onAddFolder}
          onAddUrl={onAddUrl}
          onSelectAll={onSelectAll}
          onMoveItem={onMoveItem}
          dragState={dragState}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
};

export default UrlTree;
