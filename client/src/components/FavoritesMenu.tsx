import React from 'react';
import {
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover,
    Button
} from '@fluentui/react-components';
import { Star24Regular, Star24Filled, Delete24Regular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext';

export const FavoritesMenu: React.FC = () => {
    const { favorites, removeFavorite } = useFavorites();
    const navigate = useNavigate();

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    appearance="subtle"
                    icon={favorites.length > 0 ? <Star24Filled color="#fce100" /> : <Star24Regular />}
                />
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {favorites.length === 0 ? (
                        <MenuItem disabled>Zatím žádné oblíbené položky</MenuItem>
                    ) : (
                        favorites.map(fav => (
                            <MenuItem
                                key={fav.id} // or path
                                onClick={() => navigate(fav.path)}
                                icon={<Star24Filled color="#fce100" />}
                                secondaryContent={
                                    <Button
                                        appearance="transparent"
                                        icon={<Delete24Regular />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeFavorite(fav.path);
                                        }}
                                        size="small"
                                        aria-label="Odebrat"
                                    />
                                }
                            >
                                {fav.title}
                            </MenuItem>
                        ))
                    )}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
