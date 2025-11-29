import React, { useState, useCallback, useMemo } from 'react';
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
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);

  const isSelected = item.type === 'folder' 
    ? selectedItems.folders.has(item.id)
    : selectedItems.urls.has(item.id);

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
          className={cn(
            'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
            isSelected && 'bg-primary/10 hover:bg-primary/20'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
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
      className={cn(
        'group flex items-center gap-1 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors',
        isSelected && 'bg-primary/10 hover:bg-primary/20'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
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
}) => {
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
        />
      ))}
    </div>
  );
};

export default UrlTree;
