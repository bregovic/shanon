import React from 'react';
import { Button, Tooltip } from '@fluentui/react-components';
import { Star24Regular, Star24Filled } from '@fluentui/react-icons';
import { useFavorites } from '../context/FavoritesContext';

interface FavoriteStarProps {
    path: string;
    title: string;
    module?: string;
    size?: 'small' | 'medium' | 'large';
    className?: string;
    style?: React.CSSProperties;
}

export const FavoriteStar: React.FC<FavoriteStarProps> = ({ path, title, module, size = "medium", className, style }) => {
    const { isFavorite, addFavorite, removeFavorite } = useFavorites();
    const active = isFavorite(path);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (active) {
            await removeFavorite(path);
        } else {
            await addFavorite(path, title, module);
        }
    };

    return (
        <Tooltip content={active ? "Odebrat z oblíbených" : "Přidat do oblíbených"} relationship="label">
            <Button
                appearance="subtle"
                icon={active ? <Star24Filled color="#fce100" /> : <Star24Regular />}
                onClick={handleClick}
                size={size}
                className={className}
                style={style}
            />
        </Tooltip>
    );
};
