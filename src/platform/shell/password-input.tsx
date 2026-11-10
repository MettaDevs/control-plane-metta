import { Input } from '@control-plane-metta/ui/input';
import { cn } from '@control-plane-metta/ui/utils';
import { Eye, EyeOff } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useState } from 'react';

export function PasswordInput({
    className,
    ...props
}: Omit<ComponentProps<typeof Input>, 'type'>) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="relative">
            <Input
                type={showPassword ? 'text' : 'password'}
                className={cn('pr-10', className)}
                {...props}
            />
            <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                aria-label={
                    showPassword ? 'Sembunyikan password' : 'Tampilkan password'
                }
            >
                {showPassword ? (
                    <EyeOff className="size-4" />
                ) : (
                    <Eye className="size-4" />
                )}
            </button>
        </div>
    );
}
