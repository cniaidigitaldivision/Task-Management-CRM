'use client';

import * as React from 'react';
import { ImagePlus, X, Send, Check } from 'lucide-react';

import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardToolbar,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Textarea, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', account: 'CNI Ai & Digital Division', token: 'accent-primary' },
  { id: 'instagram', label: 'Instagram', account: 'villageDiaries', token: 'accent-primary' },
  { id: 'linkedin', label: 'LinkedIn', account: 'CNI AI', token: 'accent-primary' },
  { id: 'tiktok', label: 'TikTok', account: '@cnidigital', token: 'accent-primary' },
  { id: 'youtube', label: 'YouTube', account: 'CNI Channel', token: 'accent-primary' },
] as const;

export default function ComposerPage() {
  const toast = useToast();
  
  const [selectedPlatforms, setSelectedPlatforms] = React.useState<Set<string>>(new Set());
  const [caption, setCaption] = React.useState('');
  const [youtubeTitle, setYoutubeTitle] = React.useState('');
  const [mediaFile, setMediaFile] = React.useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = React.useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = React.useState('');
  const [showSuccess, setShowSuccess] = React.useState(false);
  const [successDetails, setSuccessDetails] = React.useState<{date: string, platforms: string[]}>({ date: '', platforms: [] });

  const [tiktokPrivacy, setTiktokPrivacy] = React.useState('Public');
  const [tiktokDuet, setTiktokDuet] = React.useState(true);
  const [tiktokStitch, setTiktokStitch] = React.useState(true);
  const [tiktokComments, setTiktokComments] = React.useState(true);
  const [tiktokBranded, setTiktokBranded] = React.useState(false);
  
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Validation
  const hasAccount = selectedPlatforms.size > 0;
  const hasCaption = caption.trim().length > 0;
  const isYoutube = selectedPlatforms.has('youtube');
  const isTiktok = selectedPlatforms.has('tiktok');
  const hasYoutubeTitle = youtubeTitle.trim().length > 0;
  
  const mediaType = mediaFile?.type.startsWith('video/') ? 'video' : mediaFile?.type.startsWith('image/') ? 'image' : null;

  const warnings: string[] = [];
  if (isYoutube && mediaType !== 'video') {
    warnings.push('YouTube requires a video.');
  }
  
  const needsImageOrVideo = [];
  if (selectedPlatforms.has('instagram')) needsImageOrVideo.push('Instagram');
  if (selectedPlatforms.has('tiktok')) needsImageOrVideo.push('TikTok');
  if (needsImageOrVideo.length > 0 && !mediaType) {
    warnings.push(`${needsImageOrVideo.join('/')} requires an image or video.`);
  }

  const requirementsMet = warnings.length === 0;
  const youtubeTitleValid = !isYoutube || hasYoutubeTitle;
  
  const canSubmit = hasAccount && hasCaption && requirementsMet && youtubeTitleValid;

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMediaFile(file);
      setMediaPreview(URL.createObjectURL(file));
    }
  };

  const clearMedia = () => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSuccessDetails({
      date: scheduleDate,
      platforms: Array.from(selectedPlatforms).map(id => PLATFORMS.find(p => p.id === id)?.label || id)
    });
    setShowSuccess(true);
  };

  const handleCloseSuccess = () => {
    setShowSuccess(false);
    // Reset form
    setSelectedPlatforms(new Set());
    setCaption('');
    setYoutubeTitle('');
    clearMedia();
    setScheduleDate('');
  };

  React.useEffect(() => {
    // Cleanup preview URL on unmount
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    };
  }, [mediaPreview]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardToolbar 
          title="Composer" 
          description="Create and schedule a post across multiple platforms."
        />
        <form onSubmit={handleSubmit}>
          <CardBody className="space-y-8">
            
            {/* Target Accounts */}
            <Field label="Target Accounts" hint="Select one or more platforms to post to.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                {PLATFORMS.map((platform) => {
                  const checked = selectedPlatforms.has(platform.id);
                  return (
                    <label
                      key={platform.id}
                      className={cn(
                        'group relative flex cursor-pointer items-start gap-3 rounded-xl border p-3',
                        'transition-[background-color,border-color,box-shadow,transform] duration-[160ms]',
                        'hover:-translate-y-px',
                        checked ? 'border-border-brand bg-bg-surface-sunken' : 'border-border-subtle hover:bg-bg-hover'
                      )}
                    >
                      <div className="flex h-5 items-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border-strong text-text-brand focus:ring-focus-ring"
                          checked={checked}
                          onChange={() => togglePlatform(platform.id)}
                        />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-body-sm font-semibold text-text-primary">
                          {platform.label}
                        </span>
                        <span className="text-micro text-text-secondary truncate">
                          {platform.account}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>

            {/* TikTok Settings */}
            {isTiktok && (
              <div className="rounded-xl border border-border-default bg-bg-surface-sunken p-5 space-y-5">
                <h3 className="text-body-sm font-semibold text-text-primary border-b border-border-subtle pb-2">TikTok Settings</h3>
                
                {/* 1. Creator Info */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white font-semibold shadow-sm">
                    {PLATFORMS.find(p => p.id === 'tiktok')?.account?.charAt(1).toUpperCase() || 'C'}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-body-sm font-medium text-text-primary">
                      {PLATFORMS.find(p => p.id === 'tiktok')?.account || '@cnidigital'}
                    </span>
                    <span className="text-micro text-text-secondary truncate">
                      TikTok Creator
                    </span>
                  </div>
                </div>

                {/* 2. Privacy Selector */}
                <Field label="Who can view this post">
                  <select 
                    value={tiktokPrivacy}
                    onChange={(e) => setTiktokPrivacy(e.target.value)}
                    className={cn(
                      'w-full min-w-0 px-3 text-text-primary rounded-lg h-9 bg-bg-surface',
                      'border border-border-default hover:border-border-strong focus:border-border-brand focus:outline-none focus:ring-1 focus:ring-focus-ring',
                      'text-body-sm'
                    )}
                  >
                    <option value="Public">Public</option>
                    <option value="Friends Only">Friends Only</option>
                    <option value="Self Only">Self Only</option>
                  </select>
                </Field>

                {/* 3. Toggles */}
                <div className="space-y-3 pt-2">
                  {[
                    { label: 'Allow Duet', state: tiktokDuet, setter: setTiktokDuet },
                    { label: 'Allow Stitch', state: tiktokStitch, setter: setTiktokStitch },
                    { label: 'Allow Comments', state: tiktokComments, setter: setTiktokComments }
                  ].map(({ label, state, setter }) => (
                    <label key={label} className="flex items-center justify-between cursor-pointer group">
                      <span className="text-body-sm text-text-primary">{label}</span>
                      <div className="relative inline-flex h-5 w-9 items-center rounded-full bg-[var(--border-default)] transition-colors group-hover:bg-[var(--border-strong)]"
                        style={{ backgroundColor: state ? 'var(--accent-primary)' : undefined }}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={state}
                          onChange={(e) => setter(e.target.checked)}
                        />
                        <span className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm",
                          state ? "translate-x-4" : "translate-x-1"
                        )} />
                      </div>
                    </label>
                  ))}
                </div>

                {/* 4. Commercial Content */}
                <div className="pt-3 border-t border-border-subtle">
                  <label className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={tiktokBranded}
                      onChange={(e) => setTiktokBranded(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-border-strong text-accent-primary focus:ring-[var(--focus-ring)]"
                    />
                    <div className="flex flex-col">
                      <span className="text-body-sm text-text-primary group-hover:text-text-primary">
                        This video contains paid promotion, gifts, or other incentives.
                      </span>
                      <span className="text-micro text-text-secondary mt-0.5">
                        You are responsible for complying with TikTok's Branded Content Policy.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* YouTube Title */}
            {isYoutube && (
              <Field 
                label="Video Title" 
                hint={`${youtubeTitle.length} / 100 characters`}
                error={!hasYoutubeTitle && youtubeTitle.length > 0 ? "Title cannot be only whitespace." : undefined}
              >
                <Input
                  value={youtubeTitle}
                  onChange={(e) => setYoutubeTitle(e.target.value.slice(0, 100))}
                  placeholder="Enter a title for YouTube..."
                  invalid={!hasYoutubeTitle && youtubeTitle.length > 0}
                />
              </Field>
            )}

            {/* Caption */}
            <Field 
              label={isYoutube ? "Caption / Description" : "Caption"} 
              hint={`${caption.length} / 2200 characters`}
              error={!hasCaption && caption.length > 0 ? "Caption cannot be only whitespace." : undefined}
            >
              <Textarea
                rows={5}
                placeholder="Write your post caption..."
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
                invalid={!hasCaption && caption.length > 0}
              />
            </Field>

            {/* Media Upload */}
            <Field 
              label="Media (Optional)"
              error={warnings.length > 0 ? warnings.join(' ') : undefined}
            >
              <div className="mt-2">
                {mediaPreview ? (
                  <div className="space-y-2">
                    <div className="relative inline-block rounded-xl border border-border-subtle overflow-hidden bg-bg-surface-sunken">
                      {mediaType === 'video' ? (
                        <video src={mediaPreview} controls muted className="max-h-64 max-w-full object-contain" />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={mediaPreview} alt="Media preview" className="max-h-64 max-w-full object-contain" />
                      )}
                      <button
                        type="button"
                        onClick={clearMedia}
                        className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800/60 text-white backdrop-blur-md hover:bg-neutral-800/80 transition-colors"
                        aria-label="Remove media"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {mediaFile && (
                      <p className="text-micro text-text-secondary">
                        {mediaFile.name} &middot; {(mediaFile.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    )}
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-default bg-bg-surface-sunken py-12 px-6 text-center transition-colors',
                      'hover:border-border-strong hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
                    )}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-surface border border-border-subtle shadow-sm">
                      <ImagePlus className="h-5 w-5 text-text-secondary" />
                    </span>
                    <div>
                      <p className="text-body-sm font-semibold text-text-primary">Click to upload media</p>
                      <p className="text-micro text-text-tertiary">PNG, JPG, MP4 up to 50MB</p>
                    </div>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                />
              </div>
            </Field>

            {/* Schedule */}
            <Field label="Schedule Date & Time (Optional)" hint="Leave blank to post immediately.">
              <Input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full sm:max-w-xs"
              />
            </Field>

          </CardBody>
          <CardFooter className="flex items-center justify-between">
            <span className="text-micro text-text-secondary">
              {!hasAccount ? 'Please select at least one account.' : !hasCaption ? 'Caption is required.' : (isYoutube && !hasYoutubeTitle) ? 'YouTube title is required.' : !requirementsMet ? 'Please fix media requirements.' : 'Ready to schedule.'}
            </span>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              <Send className="mr-2 h-4 w-4" />
              Schedule Post
            </Button>
          </CardFooter>
        </form>
      </Card>
      
      {showSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border-default bg-bg-surface p-6 shadow-[var(--shadow-xl)] slide-in">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-full" style={{ backgroundColor: 'color-mix(in oklab, var(--feedback-success) 14%, transparent)' }}>
                <Check className="h-8 w-8" style={{ color: 'var(--feedback-success)' }} strokeWidth={3} />
              </div>
              <h2 className="text-h3 font-semibold text-text-primary">Post Scheduled Successfully</h2>
              <p className="mt-2 text-body-sm text-text-secondary">
                Scheduled for {successDetails.date ? new Date(successDetails.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'immediate release'} across {successDetails.platforms.join(', ')}.
              </p>
              <Button variant="primary" className="mt-6 w-full" onClick={handleCloseSuccess}>
                Create Another Post
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
