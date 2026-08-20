/**
 * shared/styles.js
 * PPT 视觉样式定义（6 套现代风格）
 * 字段说明：
 *   primary   主色（标题、强调）
 *   accent    点缀色（装饰、标记）
 *   text      正文色
 *   textSub   次要文字色
 *   bg        内容页背景
 *   bgAlt     内容页浅色区块（章节页、卡片）
 *   coverBg   封面背景（深色）
 *   coverText 封面标题色
 *   coverSub  封面副标题色
 */
(function (root) {
  'use strict';

  const STYLES = [
    {
      id: 'tech-blue',
      name: '科技蓝',
      desc: '深邃蓝 · 现代科技感',
      font: 'Microsoft YaHei',
      primary: '#1E5EFF',
      accent: '#38BDF8',
      text: '#101828',
      textSub: '#667085',
      bg: '#FFFFFF',
      bgAlt: '#EFF4FF',
      coverBg: '#0A1733',
      coverText: '#FFFFFF',
      coverSub: '#9DB8E8',
      deco1: '#1E5EFF',
      deco2: '#38BDF8'
    },
    {
      id: 'business-gold',
      name: '商务黑金',
      desc: '黑金配色 · 高端商务',
      font: 'Microsoft YaHei',
      primary: '#B08D3E',
      accent: '#D9B45B',
      text: '#1C1917',
      textSub: '#78716C',
      bg: '#FFFFFF',
      bgAlt: '#F7F3EA',
      coverBg: '#17150F',
      coverText: '#F5EFDF',
      coverSub: '#B8A87E',
      deco1: '#B08D3E',
      deco2: '#6E5A2A'
    },
    {
      id: 'fresh-green',
      name: '清新绿',
      desc: '自然绿 · 清爽治愈',
      font: 'Microsoft YaHei',
      primary: '#16A34A',
      accent: '#4ADE80',
      text: '#10231A',
      textSub: '#5B7268',
      bg: '#FFFFFF',
      bgAlt: '#EFFAF2',
      coverBg: '#0C2A1C',
      coverText: '#FFFFFF',
      coverSub: '#9CD9B4',
      deco1: '#16A34A',
      deco2: '#4ADE80'
    },
    {
      id: 'gradient-purple',
      name: '渐变紫',
      desc: '紫罗兰 · 创意先锋',
      font: 'Microsoft YaHei',
      primary: '#7C3AED',
      accent: '#C084FC',
      text: '#1E1B2E',
      textSub: '#6E6A80',
      bg: '#FFFFFF',
      bgAlt: '#F4EFFE',
      coverBg: '#170B2E',
      coverText: '#FFFFFF',
      coverSub: '#C9B0F5',
      deco1: '#7C3AED',
      deco2: '#C084FC'
    },
    {
      id: 'minimal-gray',
      name: '简约灰',
      desc: '黑白灰 · 极简主义',
      font: 'Microsoft YaHei',
      primary: '#111827',
      accent: '#6B7280',
      text: '#111827',
      textSub: '#6B7280',
      bg: '#FFFFFF',
      bgAlt: '#F3F4F6',
      coverBg: '#111827',
      coverText: '#FFFFFF',
      coverSub: '#9CA3AF',
      deco1: '#374151',
      deco2: '#6B7280'
    },
    {
      id: 'vivid-orange',
      name: '活力橙',
      desc: '暖橙 · 阳光活力',
      font: 'Microsoft YaHei',
      primary: '#EA580C',
      accent: '#FBBF24',
      text: '#2B1A10',
      textSub: '#7A6A5D',
      bg: '#FFFFFF',
      bgAlt: '#FFF4EB',
      coverBg: '#2B1204',
      coverText: '#FFFFFF',
      coverSub: '#F2C094',
      deco1: '#EA580C',
      deco2: '#FBBF24'
    }
  ];

  const api = { STYLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AIPPT = root.AIPPT || {};
  root.AIPPT.styles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
