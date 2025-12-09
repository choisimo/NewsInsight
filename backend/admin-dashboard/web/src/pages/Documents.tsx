import { useEffect, useState } from 'react';
import {
  FileText,
  Search,
  Tag,
  Folder,
  RefreshCw,
  X,
} from 'lucide-react';
import { documentsApi } from '../api/endpoints';
import type { Document } from '../types';
import clsx from 'clsx';

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [selectedCategory, selectedTag, searchQuery]);

  const loadData = async () => {
    try {
      const [categoriesData, tagsData] = await Promise.all([
        documentsApi.getCategories(),
        documentsApi.getTags(),
      ]);
      setCategories(categoriesData);
      setTags(tagsData);
      await loadDocuments();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDocuments = async () => {
    try {
      const docs = await documentsApi.list(
        selectedCategory || undefined,
        selectedTag || undefined,
        undefined,
        searchQuery || undefined
      );
      setDocuments(docs);
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const loadDocument = async (docId: string) => {
    try {
      const doc = await documentsApi.get(docId);
      setSelectedDoc(doc);
    } catch (error) {
      console.error('Failed to load document:', error);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await documentsApi.refresh();
      await loadData();
    } catch (error) {
      console.error('Failed to refresh:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'deployment':
        return 'bg-blue-500/10 text-blue-400';
      case 'troubleshooting':
        return 'bg-red-500/10 text-red-400';
      case 'architecture':
        return 'bg-purple-500/10 text-purple-400';
      case 'runbook':
        return 'bg-green-500/10 text-green-400';
      default:
        return 'bg-gray-500/10 text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">문서</h1>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="문서 검색..."
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Categories */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-white mb-3">
              <Folder className="w-4 h-4" />
              카테고리
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedCategory('')}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
                  !selectedCategory
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-300 hover:bg-gray-700'
                )}
              >
                <span>전체</span>
                <span className="text-gray-500">
                  {Object.values(categories).reduce((a, b) => a + b, 0)}
                </span>
              </button>
              {Object.entries(categories).map(([cat, count]) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors capitalize',
                    selectedCategory === cat
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'text-gray-300 hover:bg-gray-700'
                  )}
                >
                  <span>{cat}</span>
                  <span className="text-gray-500">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-white mb-3">
              <Tag className="w-4 h-4" />
              태그
            </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(tags)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15)
                .map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() =>
                      setSelectedTag(selectedTag === tag ? '' : tag)
                    }
                    className={clsx(
                      'px-2 py-1 rounded text-xs transition-colors',
                      selectedTag === tag
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    )}
                  >
                    {tag} ({count})
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Document List & Content */}
        <div className="lg:col-span-3">
          {selectedDoc ? (
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <div>
                  <h2 className="font-semibold text-white">{selectedDoc.title}</h2>
                  <p className="text-sm text-gray-400">{selectedDoc.file_path}</p>
                </div>
                <button
                  onClick={() => setSelectedDoc(null)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 border-b border-gray-700">
                <div className="flex flex-wrap gap-2">
                  <span className={clsx(
                    'px-2 py-1 rounded text-xs capitalize',
                    getCategoryColor(selectedDoc.category)
                  )}>
                    {selectedDoc.category}
                  </span>
                  {selectedDoc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-6 prose prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-gray-300 font-mono">
                  {selectedDoc.content || 'No content available'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {documents.length === 0 ? (
                <div className="col-span-2 bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-500">
                  문서가 없습니다
                </div>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => loadDocument(doc.id)}
                    className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-left hover:border-blue-500 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-white truncate">
                          {doc.title}
                        </h3>
                        <p className="text-sm text-gray-400 truncate mt-1">
                          {doc.file_path}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-xs capitalize',
                            getCategoryColor(doc.category)
                          )}>
                            {doc.category}
                          </span>
                          {doc.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
