// src/features/account-management/sales-channel/components/ApiKeyDialog.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { useUpdateChannel } from '@/lib/services/products';
import type { ChannelDto as SalesChannel } from '@/lib/types/dto/products';

interface ApiKeyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    channel?: SalesChannel | null;
    onSuccess?: () => void;
}

export function ApiKeyDialog({ open, onOpenChange, channel, onSuccess }: ApiKeyDialogProps) {
    const [form, setForm] = useState({
        apiKey: '',
        secretKey: '',
        hasOtp: false,
    });

    const isCoupang = useMemo(() => channel?.type === 'coupang', [channel]);
    const isSmartstore = useMemo(() => channel?.type === 'naver_smartstore', [channel]);

    useEffect(() => {
        if (!channel) return;
        const cfg = (channel.config || {}) as Record<string, unknown>;
        setForm({
            apiKey: (cfg.accessKey as string) || (cfg.apiKey as string) || '',
            secretKey: (cfg.secretKey as string) || '',
            hasOtp: Boolean(cfg.hasOtp),
        });
    }, [channel]);

    const update = useUpdateChannel();
    const isSubmitting = update.isPending;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!channel) return;

        try {
            const apiConfig = isCoupang
                ? { accessKey: form.apiKey, secretKey: form.secretKey, hasOtp: form.hasOtp }
                : isSmartstore
                    ? { apiKey: form.apiKey, hasOtp: form.hasOtp }
                    : { apiKey: form.apiKey, hasOtp: form.hasOtp };

            await update.mutateAsync({
                id: channel.id,
                data: { config: apiConfig },
            });

            onSuccess?.();
            onOpenChange(false);
        } catch {
            /* 상위 Alert 노출 */
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>API 연동키 수정{channel ? ` – ${channel.name}` : ''}</DialogTitle>
                </DialogHeader>

                <form onSubmit={submit} className="space-y-6">
                    {isCoupang && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Access Key</Label>
                                <Input
                                    value={form.apiKey}
                                    onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                                    placeholder="쿠팡 Access Key"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Secret Key</Label>
                                <Input
                                    value={form.secretKey}
                                    onChange={(e) => setForm((p) => ({ ...p, secretKey: e.target.value }))}
                                    placeholder="쿠팡 Secret Key"
                                    required
                                />
                            </div>
                        </div>
                    )}

                    {isSmartstore && (
                        <div className="space-y-2">
                            <Label>API ID</Label>
                            <Input
                                value={form.apiKey}
                                onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                                placeholder="스마트스토어 API ID"
                                required
                            />
                        </div>
                    )}

                    {!isCoupang && !isSmartstore && (
                        <div className="space-y-2">
                            <Label>API Key</Label>
                            <Input
                                value={form.apiKey}
                                onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                                placeholder="API Key"
                            />
                        </div>
                    )}

                    <div className="flex items-center space-x-2">
                        <Switch
                            id="hasOtp"
                            checked={form.hasOtp}
                            onCheckedChange={(v) => setForm((p) => ({ ...p, hasOtp: v }))}
                        />
                        <Label htmlFor="hasOtp">OTP 사용</Label>
                    </div>

                    {update.error && (
                        <Alert variant="destructive">
                            <AlertDescription>API 키 저장에 실패했습니다.</AlertDescription>
                        </Alert>
                    )}

                    <div className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            취소
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? '저장 중...' : '저장'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
