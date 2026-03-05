// src/components/ui/coming-soon.tsx
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface ComingSoonProps {
    title: string;
    description?: string;
    showBackButton?: boolean;
}

export function ComingSoon({ title, description, showBackButton = true }: ComingSoonProps) {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardContent className="p-8 text-center">
                    <div className="mb-6">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-8 h-8 text-blue-600" />
                        </div>
                        <Badge variant="secondary" className="mb-4">
                            준비중
                        </Badge>
                        <h1 className="text-2xl font-semibold text-gray-900 mb-2">{title}</h1>
                        {description && (
                            <p className="text-gray-600">{description}</p>
                        )}
                    </div>

                    {showBackButton && (
                        <Button
                            variant="outline"
                            onClick={() => router.back()}
                            className="w-full"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            이전 페이지로
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
} 